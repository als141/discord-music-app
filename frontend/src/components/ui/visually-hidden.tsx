// components/ui/visually-hidden.tsx
import * as React from "react";

interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

const VisuallyHidden: React.FC<VisuallyHiddenProps> = ({ children, ...props }) => {
  return (
    <span className="sr-only" {...props}>
      {children}
    </span>
  );
};

export { VisuallyHidden };