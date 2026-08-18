import {
  limitDiscordFields,
  truncateDiscord,
} from "../scripts/discord-notifier.mjs";

test("Discord text truncation preserves the limit and adds an ellipsis", () => {
  expect(truncateDiscord("abcdefgh", 5)).toBe("abcd…");
  expect(truncateDiscord("short", 10)).toBe("short");
});

test("Discord fields split long reports and stay within embed limits", () => {
  const fields = limitDiscordFields([
    {
      name: "Images",
      value: Array.from(
        { length: 20 },
        (_, index) => `image-${index} ${"x".repeat(90)}`,
      ).join("\n"),
    },
  ]);
  expect(fields.length).toBeGreaterThan(1);
  expect(fields.every((field) => field.name.length <= 256)).toBe(true);
  expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
  expect(fields.length).toBeLessThanOrEqual(25);
  expect(
    fields.reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    ),
  ).toBeLessThanOrEqual(5900);
});
