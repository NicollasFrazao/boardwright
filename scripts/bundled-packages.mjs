/**
 * The npm packages a bundle contains, from the input paths of esbuild's metafile: the directory of
 * each package under node_modules, scoped or not, once each and sorted.
 */
export function bundledPackages(inputs) {
  const directories = new Set();

  for (const input of inputs) {
    const match = /^((?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(input);

    if (match !== null) {
      directories.add(match[1]);
    }
  }

  return [...directories].sort();
}
