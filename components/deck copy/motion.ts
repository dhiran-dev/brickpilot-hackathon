"use client";

import { useReducedMotion, type Variants } from "framer-motion";

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
};

const staggerContainerReduced: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0 } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const fadeUpReduced: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
};

export function slideDirectionVariants(direction: 1 | -1): Variants {
  return {
    enter: { opacity: 0, x: 28 * direction },
    center: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
    exit: { opacity: 0, x: -28 * direction, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
  };
}

export function useDeckMotionVariants() {
  const reduce = useReducedMotion();
  return {
    container: reduce ? staggerContainerReduced : staggerContainer,
    item: reduce ? fadeUpReduced : fadeUp,
    reduceMotion: Boolean(reduce),
  };
}
