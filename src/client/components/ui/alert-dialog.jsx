import { forwardRef } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '../../lib/utils';

// shadcn's Radix composition, using TripCast tokens and existing button styles.
export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogTitle = AlertDialogPrimitive.Title;
export const AlertDialogDescription = AlertDialogPrimitive.Description;
export const AlertDialogContent = forwardRef(function AlertDialogContent({ className, ...props }, ref) {
  return <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay className="tripcast-alert-overlay" />
    <AlertDialogPrimitive.Content ref={ref} className={cn('tripcast-alert', className)} {...props} />
  </AlertDialogPrimitive.Portal>;
});
