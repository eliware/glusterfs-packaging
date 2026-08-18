export const getElement = (id) => document.getElementById(id);

export const queryAll = (selector) => [...document.querySelectorAll(selector)];

export function whenVisible(elementOrId, callback, rootMargin = "300px") {
  const element =
    typeof elementOrId === "string"
      ? document.getElementById(elementOrId)
      : elementOrId;
  if (!element) return Promise.resolve();
  if (!("IntersectionObserver" in window)) return Promise.resolve(callback());
  return new Promise((resolve, reject) => {
    let started = false;
    let observer;
    const start = () => {
      if (started) return;
      started = true;
      observer.disconnect();
      Promise.resolve(callback()).then(resolve, reject);
    };
    observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && start(),
      { rootMargin },
    );
    observer.observe(element);
  });
}
