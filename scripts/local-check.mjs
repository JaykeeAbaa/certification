import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage();
const created = [];
try {
  await page.goto("http://127.0.0.1:3000");
  await page
    .getByRole("heading", { name: "A good day to celebrate progress." })
    .waitFor();
  await expect(
    page.getByText("Local workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Test connection & save" }),
  ).toBeEnabled();
  // Verify the settings UI submits without login, without contacting any SMTP server.
  await page.route("**/api/workspace", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.action === "smtp"
    )
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "Test-only SMTP response: submission reached the server route.",
        }),
      });
    return route.continue();
  });
  await page
    .getByLabel("Sender email", { exact: true })
    .fill("test@example.com");
  await page.getByLabel("App password").fill("fictional-password");
  await page.getByRole("button", { name: "Test connection & save" }).click();
  await expect(page.locator(".notice.error")).toContainText(
    "Test-only SMTP response",
  );
  await page.unroute("**/api/workspace");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  const title = "Local upload verification " + Date.now();
  await page.getByLabel("Training title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Upload certificates", exact: true })
    .click();
  await (await chooser).setFiles("public/samples/certificates.zip");
  await expect(page.locator(".upload-count").first()).toHaveText(
    "2 certificates saved locally",
  );
  const workspace = await (
    await page.request.get("http://127.0.0.1:3000/api/workspace")
  ).json();
  const c = workspace.campaigns.find((c) => c.title === title);
  created.push(c.id);
  await page
    .locator('input[accept=".csv"]')
    .setInputFiles("public/samples/participants.csv");
  await page.getByRole("button", { name: "Import 2 participants" }).click();
  await expect(
    page.getByLabel("Certificate for Alex Santos", { exact: true }),
  ).not.toHaveValue("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".notice.success")).toContainText("Draft saved");
  await page.reload();
  await page
    .getByRole("button", { name: "Open " + title, exact: true })
    .click();
  await page.getByRole("button", { name: "Recipients & files" }).click();
  await expect(page.locator(".upload-count").first()).toHaveText(
    "2 certificates saved locally",
  );
  await expect(
    page.getByLabel("Certificate for Alex Santos", { exact: true }),
  ).not.toHaveValue("");
  const details = await (
    await page.request.get("http://127.0.0.1:3000/api/workspace?id=" + c.id)
  ).json();
  const pdf = await page.request.get(
    "http://127.0.0.1:3000/api/certificate?id=" + details.certificates[0].id,
  );
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const crossSite = await page.request.post(
    "http://127.0.0.1:3000/api/workspace",
    {
      headers: { Origin: "https://example.com", "X-Certify-Local": "1" },
      data: { action: "delete", id: c.id },
    },
  );
  expect(crossSite.status()).toBe(400);
  console.log(
    "Local browser checks passed: no login, SMTP control submits, ZIP upload, matching, persistence after reload, PDF preview and cross-site protection. No real emails sent.",
  );
} finally {
  for (const id of created)
    await page.request.post("http://127.0.0.1:3000/api/workspace", {
      headers: { "X-Certify-Local": "1" },
      data: { action: "delete", id },
    });
  await browser.close();
}
