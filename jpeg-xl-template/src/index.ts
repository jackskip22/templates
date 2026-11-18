// A Worker in front of the site's static assets. It runs only for pictures (see `run_worker_first` in wrangler.jsonc).
// A browser that accepts JPEG XL gets the copy the build made beside the picture (`cat.jpg.jxl`); every other browser,
// and any picture without a copy, gets the original. It reads no picture and encodes nothing.

const PICTURE = /\.(jpe?g|png)$/i;

// Whether an Accept header names image/jxl with a quality above zero. Wildcards do not count: a browser that
// decodes JPEG XL says so.
export function acceptsJxl(accept: string | null): boolean {
	for (const range of (accept ?? "").split(",")) {
		const [type, ...params] = range
			.split(";")
			.map((part) => part.trim().toLowerCase());
		if (type !== "image/jxl") continue;
		const q = params.find((param) => param.startsWith("q="));
		return q === undefined || Number(q.slice(2)) > 0;
	}
	return false;
}

function varied(response: Response): Response {
	const answer = new Response(response.body, response);
	answer.headers.append("Vary", "Accept");
	return answer;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const picture =
			PICTURE.test(url.pathname) &&
			(request.method === "GET" || request.method === "HEAD");
		if (!picture) return env.ASSETS.fetch(request);

		if (acceptsJxl(request.headers.get("Accept"))) {
			const copy = await env.ASSETS.fetch(
				new Request(new URL(url.pathname + ".jxl", url), request),
			);
			// A site that answers missing files with a page (single-page-application) sends HTML for a missing copy.
			const isCopy =
				copy.status === 304 ||
				(copy.ok && !copy.headers.get("Content-Type")?.startsWith("text/html"));
			if (isCopy) {
				const answer = varied(copy);
				if (copy.status !== 304)
					answer.headers.set("Content-Type", "image/jxl");
				return answer;
			}
			copy.body?.cancel();
		}
		return varied(await env.ASSETS.fetch(request));
	},
} satisfies ExportedHandler<Env>;
