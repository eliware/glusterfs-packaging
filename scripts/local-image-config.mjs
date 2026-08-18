export function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
