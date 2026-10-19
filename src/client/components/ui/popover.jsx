import { forwardRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/utils';

// shadcn's Radix composition, styled with TripCast's existing tokens.
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverContent = forwardRef(function PopoverContent(
  { className, align = 'start', sideOffset = 8, collisionPadding = 12, ...props }, ref,
) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset} collisionPadding={collisionPadding}
      className={cn('tripcast-popover', className)} {...props} />
  </PopoverPrimitive.Portal>;
});
