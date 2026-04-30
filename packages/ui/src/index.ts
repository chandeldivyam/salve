// @opendesk/ui — shadcn-derived components, design tokens.

export const UI_PACKAGE = '@opendesk/ui' as const;

export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  type AvatarProps,
  initialsFromName,
} from './avatar.js';
export { Badge, type BadgeProps, badgeVariants } from './badge.js';
export { Button, type ButtonProps, buttonVariants } from './button.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type CardTitleProps,
} from './card.js';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
export {
  Field,
  FieldDescription,
  FieldError,
  type FieldErrorProps,
  FieldGroup,
  FieldLabel,
  type FieldLabelProps,
  type FieldProps,
  useFieldContext,
} from './field.js';
export { FormActions, type FormActionsProps } from './form-actions.js';
export { Input, type InputProps } from './input.js';
export { Label } from './label.js';
export { LoadingButton, type LoadingButtonProps } from './loading-button.js';
export { Logo, type LogoProps } from './logo.js';
export { ScrollArea } from './scroll-area.js';
export { Separator } from './separator.js';
export { Skeleton } from './skeleton.js';
export { Textarea, type TextareaProps } from './textarea.js';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';
export { cn } from './utils.js';
