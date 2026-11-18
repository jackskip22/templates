// Copies public/ to dist/ and writes a JPEG XL copy beside each picture: `cat.jpg` gets `cat.jpg.jxl`.
// JPEGs are recompressed without loss, and each copy is checked to restore the same JPEG, byte for byte.
// PNGs are encoded exactly: every pixel is kept. A copy is kept only when it is smaller than the picture.
// A copy newer than its picture is reused, so a second build only converts what changed; files whose picture was
// removed from public/ are removed from dist/.
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { encode } from "jpegxl";
import { recompress, restore } from "jpegxl/jpeg";

const from = "public";
const to = "dist";
const effort = Number(process.env.JXL_EFFORT ?? 7);
const PICTURE = /\.(jpe?g|png)$/i;

async function newer(file, than) {
	try {
		return (await stat(file)).mtimeMs >= (await stat(than)).mtimeMs;
	} catch {
		return false;
	}
}

async function convert(source) {
	const bytes = new Uint8Array(await readFile(source));
	if (/\.png$/i.test(source)) {
		const { bytes: jxl } = await encode(
			new Blob([bytes], { type: "image/png" }),
			{ fidelity: "exact", effort },
		);
		return { bytes, jxl };
	}
	const { bytes: jxl } = await recompress(bytes, { effort });
	const { bytes: back } = await restore(jxl);
	if (Buffer.compare(Buffer.from(back), Buffer.from(bytes)) !== 0) {
		throw new Error(`${source}: the copy does not restore the same JPEG`);
	}
	return { bytes, jxl };
}

let before = 0;
let after = 0;
async function walk(dir) {
	await mkdir(join(to, relative(from, dir)), { recursive: true });
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const source = join(dir, entry.name);
		const target = join(to, relative(from, source));
		if (entry.isDirectory()) {
			await walk(source);
			continue;
		}
		await copyFile(source, target);
		if (!PICTURE.test(entry.name)) continue;
		const copy = `${target}.jxl`;
		const size = (await stat(source)).size;
		if (await newer(copy, source)) {
			before += size;
			after += (await stat(copy)).size;
			continue;
		}
		await rm(copy, { force: true });
		try {
			const { bytes, jxl } = await convert(source);
			before += bytes.byteLength;
			if (jxl.byteLength < bytes.byteLength) {
				await writeFile(copy, jxl);
				after += jxl.byteLength;
				console.log(
					`${relative(from, source)}: ${bytes.byteLength} B, JPEG XL ${jxl.byteLength} B`,
				);
			} else {
				after += bytes.byteLength;
				console.log(
					`${relative(from, source)}: kept as it is, the copy was not smaller`,
				);
			}
		} catch (error) {
			// A picture the encoder refuses is served as it is.
			before += size;
			after += size;
			console.log(
				`${relative(from, source)}: kept as it is (${error.code ?? error.message})`,
			);
		}
	}
}

// Files left in dist/ from pictures since removed from public/, copies included.
async function prune(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const target = join(dir, entry.name);
		const source = join(from, relative(to, target)).replace(
			/(\.(jpe?g|png))\.jxl$/i,
			"$1",
		);
		if (entry.isDirectory()) await prune(target);
		else if (!(await stat(source).catch(() => null))) await rm(target);
	}
}

await walk(from);
await prune(to);
if (before)
	console.log(
		`Pictures: ${before} B, served as JPEG XL: ${after} B (${Math.round((1 - after / before) * 100)}% smaller)`,
	);
