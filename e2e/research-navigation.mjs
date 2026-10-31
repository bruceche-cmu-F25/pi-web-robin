/** The same tree is always visible on desktop and disclosed on phones. */
export async function openResearchNavigation(page) {
  const trigger = page.getByRole("button", { name: /^Research projects ·/ });
  if (await trigger.isVisible() && await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}

/** Navigate through the grouped sidebar, without depending on a group's live count. */
export async function openResearchProject(page, name) {
  await openResearchNavigation(page);
  const group = page.getByRole("navigation", { name: "Research projects" }).getByRole("region", { name, exact: true });
  const toggle = group.locator('button[aria-expanded]').first();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await group.getByRole("link", { name: "Overview", exact: true }).click();
}
