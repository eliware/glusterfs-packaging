import "./styles.css";
import { initCopyControls } from "./copy-controls.mjs";
import { initDirectoryBrowser } from "./directory-browser.mjs";
import { initImageBrowser } from "./image-browser.mjs";
import { initPanels } from "./panels.mjs";
import { initReleaseWizard } from "./release-wizard.mjs";
import { initReleaseExperience } from "./release-experience.mjs";
import { initValidationMatrix } from "./validation-matrix.mjs";
import { initBlog } from "./blog.mjs";
import { whenVisible } from "./dom.mjs";

initCopyControls();
initPanels();
initReleaseWizard();
whenVisible("directory-entries", () => initDirectoryBrowser()).catch(() => {
  const status = document.getElementById("directory-status");
  if (status)
    status.textContent = "Directory metadata is temporarily unavailable.";
});
whenVisible("image-browser", initImageBrowser);
whenVisible("validation-matrix", initValidationMatrix);
whenVisible("release-workspace", initReleaseExperience);
initBlog();
