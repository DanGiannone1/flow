"""Application-level auth for the orchestrator API.

Supports either Microsoft Entra bearer tokens or a shared API key header.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from jwt import InvalidTokenError, PyJWKClient

logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _csv_env(name: str) -> list[str]:
    raw = os.getenv(name, "")
    values = []
    for item in raw.split(","):
        cleaned = item.strip()
        if cleaned:
            values.append(cleaned)
    return values


def _unique(values: list[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return tuple(ordered)


@dataclass(frozen=True, slots=True)
class AuthConfig:
    required: bool
    api_key: str | None
    tenant_id: str | None
    api_client_id: str | None
    allowed_audiences: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "AuthConfig":
        api_client_id = os.getenv("ENTRA_API_CLIENT_ID") or os.getenv("ENTRA_CLIENT_ID") or None
        audiences = _csv_env("ENTRA_ALLOWED_AUDIENCES") + _csv_env("ENTRA_API_AUDIENCES")
        if api_client_id:
            audiences = [api_client_id, f"api://{api_client_id}", *audiences]
        return cls(
            required=_env_flag("API_AUTH_REQUIRED", default=False),
            api_key=os.getenv("API_KEY") or os.getenv("LOCAL_API_KEY") or None,
            tenant_id=os.getenv("ENTRA_TENANT_ID") or None,
            api_client_id=api_client_id,
            allowed_audiences=_unique(audiences),
        )

    @property
    def bearer_enabled(self) -> bool:
        return bool(self.tenant_id and self.allowed_audiences)

    @property
    def enabled(self) -> bool:
        return self.required or bool(self.api_key) or self.bearer_enabled


class APIAuthenticator:
    def __init__(self, config: AuthConfig):
        self.config = config
        self._jwks_client = (
            PyJWKClient(f"https://login.microsoftonline.com/{config.tenant_id}/discovery/v2.0/keys")
            if config.bearer_enabled
            else None
        )

    async def authenticate(self, request: Request) -> JSONResponse | None:
        if request.method == "OPTIONS" or request.url.path == "/health":
            return None

        api_key = request.headers.get("x-api-key")
        if api_key:
            if self._check_api_key(api_key):
                request.state.auth_method = "api_key"
                return None
            return self._unauthorized("Invalid API key.")

        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            if not self._jwks_client:
                return self._unauthorized("Bearer authentication is not configured.")
            token = auth_header.split(" ", 1)[1].strip()
            if not token:
                return self._unauthorized("Missing bearer token.")
            try:
                claims = await self._validate_token(token)
            except InvalidTokenError as exc:
                logger.info("Bearer token rejected: %s", exc)
                return self._unauthorized("Invalid bearer token.")
            except Exception:
                logger.exception("Bearer token validation failed unexpectedly")
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Authentication service unavailable."},
                )
            request.state.auth_method = "bearer"
            request.state.auth_claims = claims
            return None

        if self.config.required:
            return self._unauthorized("Authentication required.")
        return None

    def _check_api_key(self, supplied: str) -> bool:
        expected = self.config.api_key
        return bool(expected) and secrets.compare_digest(supplied, expected)

    async def _validate_token(self, token: str) -> dict[str, Any]:
        assert self._jwks_client is not None
        signing_key = await asyncio.to_thread(self._jwks_client.get_signing_key_from_jwt, token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=self.config.allowed_audiences,
            options={"require": ["exp", "iss", "aud"]},
        )

        tenant_id = self.config.tenant_id
        if tenant_id and claims.get("tid") != tenant_id:
            raise InvalidTokenError("Unexpected tenant")

        issuer = claims.get("iss")
        if issuer not in self._allowed_issuers():
            raise InvalidTokenError("Unexpected issuer")

        return claims

    def _allowed_issuers(self) -> set[str]:
        tenant_id = self.config.tenant_id
        if not tenant_id:
            return set()
        return {
            f"https://login.microsoftonline.com/{tenant_id}",
            f"https://login.microsoftonline.com/{tenant_id}/",
            f"https://login.microsoftonline.com/{tenant_id}/v2.0",
            f"https://login.microsoftonline.com/{tenant_id}/v2.0/",
            f"https://sts.windows.net/{tenant_id}/",
        }

    @staticmethod
    def _unauthorized(detail: str) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"detail": detail},
            headers={"WWW-Authenticate": "Bearer"},
        )
