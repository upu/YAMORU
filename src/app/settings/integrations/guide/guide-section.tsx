"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./integration-guide.module.css";

export function GuideSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const revealLinkedSection = () => {
      if (window.location.hash !== `#${id}` || !details.current) return;
      details.current.open = true;
      document.getElementById(id)?.scrollIntoView();
    };
    revealLinkedSection();
    window.addEventListener("hashchange", revealLinkedSection);
    return () => { window.removeEventListener("hashchange", revealLinkedSection); };
  }, [id]);

  return <details ref={details} className={`detail-card ${styles.section}`}>
    <summary><h2>{title}</h2></summary>
    <div id={id}>{children}</div>
  </details>;
}
