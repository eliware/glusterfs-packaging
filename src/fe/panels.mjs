import { getElement, queryAll } from "./dom.mjs";

export function initPanels() {
  queryAll("[data-panel]").forEach((button) =>
    button.addEventListener("click", () => {
      queryAll("[data-panel]").forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-selected", "false");
      });
      queryAll(".panel").forEach((panel) => panel.classList.add("d-none"));
      button.classList.add("active");
      button.setAttribute("aria-selected", "true");
      getElement(button.dataset.panel).classList.remove("d-none");
    }),
  );
}
