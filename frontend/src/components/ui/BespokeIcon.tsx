"use client";

import React from "react";
import { LucideIcon } from "lucide-react";

interface BespokeIconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
  glowColor?: string;
  strokeWidth?: number;
}

/**
 * Renders a Lucide icon with a branded glowing background layer
 * to create a bespoke, duo-tone identity.
 */
export default function BespokeIcon({
  icon: Icon,
  size = 18,
  className = "",
  glowColor,
  strokeWidth = 2,
}: BespokeIconProps) {
  return (
    <div className={`icon-glow-container ${className}`}>
      {/* Background Glow Layer */}
      <div 
        className="icon-glow-layer" 
        style={{ color: glowColor || "currentColor" }}
      />
      
      {/* Primary Icon */}
      <Icon 
        size={size} 
        strokeWidth={strokeWidth} 
        className="relative z-10" 
      />
    </div>
  );
}
