// @opendesk/ui — shadcn-derived components, design tokens.

export const UI_PACKAGE = '@opendesk/ui' as const;

export { Button, type ButtonProps, buttonVariants } from './button.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card.js';
export { Input, type InputProps } from './input.js';
export { Label } from './label.js';
export { cn } from './utils.js';
