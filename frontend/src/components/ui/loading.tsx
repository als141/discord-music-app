import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingProps {
  /**
   * Size of the loading spinner
   */
  size?: 'small' | 'medium' | 'large';
  
  /**
   * Text to display along with the spinner
   */
  text?: string;
  
  /**
   * Whether to show as a full page overlay
   */
  fullPage?: boolean;
  
  /**
   * Additional CSS classes
   */
  className?: string;
  
  /**
   * Time in milliseconds before showing loading indicator (to prevent flashing)
   */
  delay?: number;
}

/**
 * Loading spinner component with configurable size and text
 */
export const Loading: React.FC<LoadingProps> = ({
  size = 'medium',
  text,
  fullPage = false,
  className,
  delay = 0
}) => {
  const [showLoading, setShowLoading] = React.useState(delay === 0);
  
  React.useEffect(() => {
    if (delay > 0) {
      const timer = setTimeout(() => setShowLoading(true), delay);
      return () => clearTimeout(timer);
    }
  }, [delay]);
  
  if (!showLoading) {
    return null;
  }
  
  const sizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-12 h-12'
  };
  
  const loadingContent = (
    <div className={cn(
      'flex flex-col items-center justify-center',
      fullPage ? 'fixed inset-0 bg-background/80 backdrop-blur-sm z-50' : '',
      className
    )}>
      <Loader2 className={cn(
        'animate-spin text-primary',
        sizeClasses[size]
      )} aria-hidden="true" />
      
      {text && (
        <p className="mt-2 text-sm text-muted-foreground">
          {text}
        </p>
      )}
      
      <span className="sr-only">Loading{text ? `: ${text}` : ''}</span>
    </div>
  );
  
  return loadingContent;
};

export default Loading;