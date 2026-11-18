import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { acceptsJxl } from "../src/index";

const JXL = "image/jxl,image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const NO_JXL = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

// The first bytes of a JPEG XL file: a container, or a bare codestream.
function isJxl(bytes: Uint8Array): boolean {
	return (
		(bytes[0] === 0xff && bytes[1] === 0x0a) ||
		(bytes[4] === 0x4a &&
			bytes[5] === 0x58 &&
			bytes[6] === 0x4c &&
			bytes[7] === 0x20)
	);
}

describe("the built site", () => {
	it("serves the page", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("<h1>JPEG XL Images</h1>");
	});

	it("sends JPEG XL to a browser that accepts it", async () => {
		const response = await SELF.fetch(
			"https://example.com/images/balloon.jpg",
			{
				headers: { Accept: JXL },
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/jxl");
		expect(response.headers.get("Vary")).toContain("Accept");
		expect(isJxl(new Uint8Array(await response.arrayBuffer()))).toBe(true);
	});

	it("sends the JPEG to every other browser", async () => {
		const response = await SELF.fetch(
			"https://example.com/images/balloon.jpg",
			{
				headers: { Accept: NO_JXL },
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/jpeg");
		expect(response.headers.get("Vary")).toContain("Accept");
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
	});

	it.each(["mountain", "flowers", "niagara", "balloon"])(
		"sends %s.jpg smaller as JPEG XL",
		async (name) => {
			const url = `https://example.com/images/${name}.jpg`;
			const jxl = await SELF.fetch(url, { headers: { Accept: JXL } });
			const jpeg = await SELF.fetch(url, { headers: { Accept: NO_JXL } });
			expect(jxl.headers.get("Content-Type")).toBe("image/jxl");
			expect((await jxl.arrayBuffer()).byteLength).toBeLessThan(
				(await jpeg.arrayBuffer()).byteLength,
			);
		},
	);

	it("answers a picture that does not exist with 404", async () => {
		const response = await SELF.fetch("https://example.com/images/none.jpg", {
			headers: { Accept: JXL },
		});
		expect(response.status).toBe(404);
	});
});

// The Worker against a stand-in for the assets: a picture with no copy, a site that answers missing files with a page.
function assets(files: Record<string, string>, missing = 404) {
	return {
		fetch: async (input: Request | string) => {
			const request = new Request(input);
			const path = new URL(request.url).pathname;
			if (path in files)
				return new Response(request.method === "HEAD" ? null : path, {
					headers: { "Content-Type": files[path] },
				});
			return missing === 200
				? new Response("<!doctype html>", {
						headers: { "Content-Type": "text/html; charset=utf-8" },
					})
				: new Response("Not found", { status: 404 });
		},
	};
}
const call = (path: string, accept: string, env: object, method = "GET") =>
	worker.fetch(
		new Request(`https://example.com${path}`, {
			method,
			headers: { Accept: accept },
		}) as never,
		env as never,
	);
const body = async (response: Response) =>
	new TextDecoder().decode(await response.arrayBuffer());

describe("the Worker", () => {
	it("falls back to the original when a picture has no copy", async () => {
		const response = await call("/a.png", JXL, {
			ASSETS: assets({ "/a.png": "image/png" }),
		});
		expect(response.headers.get("Content-Type")).toBe("image/png");
		expect(await body(response)).toBe("/a.png");
	});

	it("falls back when a missing copy is answered with a page", async () => {
		const response = await call("/a.jpg", JXL, {
			ASSETS: assets({ "/a.jpg": "image/jpeg" }, 200),
		});
		expect(response.headers.get("Content-Type")).toBe("image/jpeg");
		expect(await body(response)).toBe("/a.jpg");
	});

	it("answers HEAD with the copy's headers", async () => {
		const response = await call(
			"/a.jpg",
			JXL,
			{
				ASSETS: assets({
					"/a.jpg": "image/jpeg",
					"/a.jpg.jxl": "application/octet-stream",
				}),
			},
			"HEAD",
		);
		expect(response.headers.get("Content-Type")).toBe("image/jxl");
	});

	it("passes every other file through untouched", async () => {
		const response = await call("/index.html", JXL, {
			ASSETS: assets({ "/index.html": "text/html" }),
		});
		expect(response.headers.get("Vary")).toBeNull();
		expect(await response.text()).toBe("/index.html");
	});

	it("reads Accept: image/jxl only, never a wildcard, and not at q=0", () => {
		expect(acceptsJxl(JXL)).toBe(true);
		expect(acceptsJxl("image/JXL;q=0.5")).toBe(true);
		expect(acceptsJxl(NO_JXL)).toBe(false);
		expect(acceptsJxl("image/jxl;q=0, image/*")).toBe(false);
		expect(acceptsJxl(null)).toBe(false);
	});
});
