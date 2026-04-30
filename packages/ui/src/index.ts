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
export { Input, type InputProps } from './input.js';
export { Label } from './label.js';
export { Logo, type LogoProps } from './logo.js';
export { ScrollArea } from './scroll-area.js';
export { Separator } from './separator.js';
export { Skeleton } from './skeleton.js';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';
export { cn } from './utils.js';
