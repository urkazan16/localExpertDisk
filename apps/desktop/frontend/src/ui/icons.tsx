import type { SVGProps } from "react";

export type IconName =
  | "applications"
  | "back"
  | "chevron-down"
  | "close"
  | "delete"
  | "disk"
  | "downloads"
  | "file"
  | "folder"
  | "forward"
  | "help"
  | "home"
  | "info"
  | "refresh"
  | "search";

const paths: Record<IconName, string[]> = {
  applications: [
    "M7 3h4v4H7zM13 3h4v4h-4zM7 9h4v4H7zM13 9h4v4h-4zM7 15h4v4H7zM13 15h4v4h-4z",
  ],
  back: ["m15 18-6-6 6-6"],
  "chevron-down": ["m7 10 5 5 5-5"],
  close: ["m7 7 10 10M17 7 7 17"],
  delete: ["M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14"],
  disk: ["M4 7h16l-1.5 10h-13z", "M7 14h10"],
  downloads: ["M12 3v11m0 0 4-4m-4 4-4-4", "M5 18h14v3H5z"],
  file: ["M7 3h7l4 4v14H7z", "M14 3v5h4"],
  folder: ["M3 6h7l2 2h9v11H3z"],
  forward: ["m9 18 6-6-6-6"],
  help: [
    "M9.5 9a2.75 2.75 0 1 1 4.4 2.2c-1.15.85-1.9 1.3-1.9 2.8",
    "M12 18h.01",
  ],
  home: ["m3 11 9-8 9 8", "M5 10v11h14V10M9 21v-7h6v7"],
  info: ["M12 10v7", "M12 7h.01", "M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0"],
  refresh: [
    "M20 6v5h-5",
    "M4 18v-5h5",
    "M6.1 8A7 7 0 0 1 18 6l2 5",
    "M17.9 16A7 7 0 0 1 6 18l-2-5",
  ],
  search: ["M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15", "m16 16 5 5"],
};

export function Icon({
  name,
  label,
  size = 20,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  label?: string;
  size?: number;
}) {
  return (
    <svg
      {...props}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={["ui-icon", props.className].filter(Boolean).join(" ")}
      fill="none"
      height={size}
      role={label ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}
