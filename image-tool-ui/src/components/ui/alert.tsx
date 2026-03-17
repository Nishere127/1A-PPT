import * as React from "react";

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" }
>(({ className = "", variant = "default", ...props }, ref) => {
  const variants = {
    default: "bg-muted text-foreground",
    destructive: "bg-destructive/10 text-destructive border-border",
  };
  return (
    <div
      ref={ref}
      role="alert"
      className={`relative w-full rounded-lg border p-4 ${variants[variant]} ${className}`}
      {...props}
    />
  );
});
Alert.displayName = "Alert";

export { Alert };
