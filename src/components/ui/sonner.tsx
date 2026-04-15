"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[var(--card-bg)] group-[.toaster]:text-foreground group-[.toaster]:border-[var(--card-border)] group-[.toaster]:shadow-lg group-[.toaster]:backdrop-blur-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toast]:!text-[var(--ave-teal)]",
          error: "group-[.toast]:!text-destructive",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
