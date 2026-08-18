import { getElement, queryAll } from "./dom.mjs";

const copyIcon = "⧉";

export function initCopyControls() {
  queryAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      const icon = button.querySelector(".copy-icon");
      const originalLabel = button.textContent;
      try {
        await navigator.clipboard.writeText(
          getElement(button.dataset.copy).innerText,
        );
        if (icon) {
          icon.textContent = "✓";
          button.classList.add("btn-success");
        } else button.textContent = "Copied";
        setTimeout(() => {
          if (icon) {
            icon.textContent = copyIcon;
            button.classList.remove("btn-success");
          } else button.textContent = originalLabel;
        }, 3000);
      } catch {
        if (icon) {
          icon.textContent = "!";
          setTimeout(() => {
            icon.textContent = copyIcon;
          }, 3000);
        } else {
          button.textContent = "Retry";
          setTimeout(() => {
            button.textContent = originalLabel;
          }, 3000);
        }
      }
    }),
  );
}
