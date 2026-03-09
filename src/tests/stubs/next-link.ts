type LinkProps = {
  href?: string;
  children?: unknown;
};

export default function Link(props: LinkProps) {
  return (props.children ?? null) as any;
}
