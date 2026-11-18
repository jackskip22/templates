import { test, expect } from "./fixtures";

test.describe("JPEG XL Images Template", () => {
	test("shows four photographs, their sizes and the total", async ({
		page,
		templateUrl,
	}) => {
		await page.goto(templateUrl);
		await expect(
			page.getByRole("heading", { name: "JPEG XL Images" }),
		).toBeVisible();
		await expect(page.locator("main img")).toHaveCount(4);
		for (const img of await page.locator("main img").all())
			await expect(img).toBeVisible();
		await expect(page.locator("figcaption").first()).toContainText("JPEG XL");
		await expect(page.locator("#total")).toContainText("% smaller");
	});

	test("answers the same address with JPEG XL or the JPEG", async ({
		request,
		templateUrl,
	}) => {
		const jxl = await request.get(`${templateUrl}/images/balloon.jpg`, {
			headers: { Accept: "image/jxl,*/*;q=0.8" },
		});
		expect(jxl.headers()["content-type"]).toBe("image/jxl");
		const jpeg = await request.get(`${templateUrl}/images/balloon.jpg`, {
			headers: { Accept: "image/webp,*/*;q=0.8" },
		});
		expect(jpeg.headers()["content-type"]).toBe("image/jpeg");
		expect((await jxl.body()).length).toBeLessThan((await jpeg.body()).length);
	});
});
