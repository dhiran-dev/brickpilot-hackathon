"use client";

import { useEffect } from "react";

/**
 * Attaches scroll-triggered reveals to any `.landing-view-reveal` element.
 * The hidden pre-reveal state is only applied once this component runs
 * (`.reveal-ready`), so the page stays fully visible without JavaScript.
 */
export function LandingReveal() {
  useEffect(() => {
    const root = document.querySelector(".landing");
    if (!root) return;

    const elements = Array.from(root.querySelectorAll(".landing-view-reveal"));
    if (elements.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    root.classList.add("reveal-ready");

    const reveal = (element: Element) => element.classList.add("is-visible");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );

    elements.forEach((element) => observer.observe(element));

    // Fallback: if the observer never delivers (odd embeds, prerenderers),
    // anything already inside the viewport must not stay hidden.
    const fallback = window.setTimeout(() => {
      for (const element of elements) {
        if (element.getBoundingClientRect().top < window.innerHeight) {
          reveal(element);
        }
      }
    }, 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
