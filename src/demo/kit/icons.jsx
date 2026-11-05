/* The PackPerks cup (the same drawing as the customer app's cup icon) and the reward star. */

export function CupSvg() {
  return (
    <svg viewBox="0 0 33 32" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.23" strokeLinecap="round" strokeLinejoin="round">
        <path d="M25.53 6.55H6.72c-.74 0-1.34.59-1.34 1.31v2.62c0 .72.6 1.31 1.34 1.31h18.81c.74 0 1.34-.59 1.34-1.31V7.86c0-.72-.6-1.31-1.34-1.31Z" />
        <path d="M8.06 11.78l2.02 14.4h12.09l2.02-14.4" />
      </g>
      <path fill="currentColor" d="M14.94 20.59c.2-.24.55-.57.79-.8l1.43-1.43 1.89-1.89.57-.57c.11-.11.23-.23.34-.35.4-.39 1.02-.3 1.29.19.03.06.05.15.08.21v.3c-.06.12-.08.24-.18.36-.1.11-.21.22-.32.32l-.56.56-1.71 1.71-2.04 2.04-.65.65c-.12.12-.25.25-.37.37-.33.32-.81.31-1.14 0-.18-.18-.36-.36-.54-.54l-.99-.99-.82-.82c-.17-.17-.34-.34-.5-.52-.07-.08-.1-.18-.14-.28-.01-.03-.01-.05-.03-.08v-.27c.01-.02.04-.11.05-.14.03-.1.11-.21.18-.28.15-.15.35-.23.56-.23.34 0 .51.17.73.39l.42.42 1.66 1.66Z" />
    </svg>
  );
}

export function StarSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9L12 3.2Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
