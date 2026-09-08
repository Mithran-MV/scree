"use client";

import type { ReactNode } from "react";

/**
 * A brass porthole: the instrument controls down the eastern wall.
 *
 * The bezel, rivets and glass are all drawn, so a porthole costs no asset and
 * stays sharp at any size. `lit` marks the instrument currently in use.
 */
export function Porthole({
  label,
  lit = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  lit?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`porthole${lit ? " lit" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "not wired up yet" : label}
      type="button"
    >
      <span className="bezel">
        <span className="rivets" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} style={{ transform: `rotate(${i * 45}deg) translateY(-40px)` }} />
          ))}
        </span>
        <span className="glass">{children}</span>
      </span>
      <span className="plate">{label}</span>
    </button>
  );
}
