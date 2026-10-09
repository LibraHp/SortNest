import { Children, Fragment, isValidElement, type ReactNode } from "react";
import {
  Button as AntButton,
  Select as AntSelect,
  type ButtonProps,
  type SelectProps,
} from "antd";

// Keep the app's semantic action styles in one place; Ant Design owns control behavior.
export function Button({
  className = "",
  type = "button",
  ...props
}: Omit<ButtonProps, "type"> & { type?: "button" | "submit" | "reset" }) {
  const classes = className.split(/\s+/);
  return (
    <AntButton
      {...props}
      htmlType={type}
      className={className}
      danger={classes.includes("danger")}
      type={
        classes.includes("primary") || classes.includes("solid")
          ? "primary"
          : classes.includes("icon-button") || classes.includes("link-button")
            ? "text"
            : "default"
      }
    />
  );
}

type Option = { value: string; label: ReactNode; disabled?: boolean };
function optionsFromChildren(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === Fragment)
      return optionsFromChildren(child.props.children);
    return [
      {
        value: String(child.props.value ?? child.props.children ?? ""),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
}

export function Select({
  children,
  value,
  className = "",
  ...props
}: Omit<SelectProps<string>, "children" | "options" | "value"> & {
  children: ReactNode;
  value?: string | number;
}) {
  return (
    <AntSelect
      {...props}
      value={value == null ? undefined : String(value)}
      className={`app-select ${className}`}
      options={optionsFromChildren(children)}
    />
  );
}

export { Input, Checkbox } from "antd";
