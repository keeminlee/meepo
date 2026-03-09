type IconProps = {
  className?: string;
};

function makeIcon() {
  return function Icon(_props: IconProps) {
    return null;
  };
}

export const ArrowRight = makeIcon();
export const BookOpen = makeIcon();
export const Sparkles = makeIcon();
export const Star = makeIcon();
