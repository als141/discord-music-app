"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      className="h-full w-full rounded-[inherit]"
      style={{
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex select-none transition-colors duration-200",
      // Vertical scrollbar
      orientation === "vertical" &&
        "h-full w-2 sm:w-2.5 border-l border-l-transparent p-[1px] hover:w-3",
      // Horizontal scrollbar
      orientation === "horizontal" &&
        "h-2 sm:h-2.5 flex-col border-t border-t-transparent p-[1px] hover:h-3",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className={cn(
        "relative flex-1 rounded-full transition-colors duration-200",
        "bg-border/60 hover:bg-border active:bg-border"
      )}
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
