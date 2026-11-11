function dot(a, b) {
  let result = 0;
  for (let j = 0; j < a.length; j++) result += a[j] * b[j];
  return result;
}

function randomSequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spherical k-means in every supplied dimension; no PCA coordinates or labels. */
export function clusterEmbeddings(embeddings, requestedK, { seed = 42, restarts = 4, maxIterations = 150, onProgress } = {}) {
  const dimensions = embeddings[0]?.length ?? 0, count = embeddings.length;
  if (!dimensions || count < 2 || !Number.isInteger(requestedK) || requestedK < 1 || requestedK > count)
    throw new Error('Invalid embeddings or cluster count');
  const rows = embeddings.map(row => {
    if (row.length !== dimensions || !Array.from(row).every(Number.isFinite)) throw new Error('Invalid embedding');
    const norm = Math.hypot(...row);
    if (!norm) throw new Error('Zero embedding');
    return Float64Array.from(row, value => value / norm);
  });
  let best;
  for (let restart = 0; restart < restarts; restart++) {
    const random = randomSequence(seed + restart * 104729);
    let centers = [rows[Math.floor(random() * count)].slice()];
    const distances = new Float64Array(count).fill(Infinity);
    while (centers.length < requestedK) {
      const newest = centers.at(-1);
      let total = 0;
      for (let i = 0; i < count; i++) {
        distances[i] = Math.min(distances[i], Math.max(0, 1 - dot(rows[i], newest)));
        total += distances[i];
      }
      if (total < 1e-10) break;
      let target = random() * total, chosen = count - 1;
      for (let i = 0; i < count; i++) if ((target -= distances[i]) <= 0) { chosen = i; break; }
      centers.push(rows[chosen].slice());
    }
    const labels = new Int32Array(count).fill(-1);
    let converged = false, iterations = 0;
    for (; iterations < maxIterations; iterations++) {
      const counts = new Int32Array(centers.length);
      const sums = centers.map(() => new Float64Array(dimensions));
      let changed = 0;
      for (let i = 0; i < count; i++) {
        let chosen = 0, similarity = -Infinity;
        for (let c = 0; c < centers.length; c++) {
          const value = dot(rows[i], centers[c]);
          if (value > similarity) { similarity = value; chosen = c; }
        }
        if (labels[i] !== chosen) changed++;
        labels[i] = chosen;
        counts[chosen]++;
        for (let j = 0; j < dimensions; j++) sums[chosen][j] += rows[i][j];
      }
      if (counts.some(value => value === 0)) {
        centers = centers.filter((_, c) => counts[c] > 0);
        labels.fill(-1);
        continue;
      }
      centers = sums.map((sum, c) => {
        const norm = Math.hypot(...sum);
        return norm > 1e-12 ? sum.map(value => value / norm) : centers[c];
      });
      if (!changed) { converged = true; iterations++; break; }
    }
    if (!converged) continue;
    let objective = 0;
    const groups = centers.map(center => ({ center: Array.from(center), indices: [] }));
    for (let i = 0; i < count; i++) {
      groups[labels[i]].indices.push(i);
      objective += Math.max(0, 1 - dot(rows[i], centers[labels[i]]));
    }
    onProgress?.({ restart: restart + 1, iterations, objective });
    if (!best || objective < best.objective - 1e-12) best = { groups, objective, iterations, restart: restart + 1 };
  }
  if (!best) throw new Error('Spherical k-means did not converge');
  best.groups.sort((a, b) => a.indices[0] - b.indices[0]);
  return { ...best, dimensions, seed, restarts };
}

/** Exact shortest open path between a small number of normalized group centers. */
export function orderCentroids(centers) {
  const count = centers.length;
  if (!count || count > 8) throw new Error('Ordering supports 1–8 centroids');
  const distance = centers.map(a => centers.map(b => Math.max(0, 1 - dot(a, b))));
  let bestPath = [], bestCost = Infinity;
  const visit = (path, cost) => {
    if (cost > bestCost + 1e-12) return;
    if (path.length === count) {
      // Reverse paths are equivalent. Fix a direction by original corpus index.
      if (count > 1 && path[0] > path.at(-1)) return;
      if (cost < bestCost - 1e-12 || !bestPath.length) { bestCost = cost; bestPath = [...path]; }
      return;
    }
    for (let next = 0; next < count; next++) if (!path.includes(next))
      visit([...path, next], cost + (path.length ? distance[path.at(-1)][next] : 0));
  };
  visit([], 0);
  return { order: bestPath, totalDistance: bestCost,
    neighborDistances: bestPath.slice(1).map((value, i) => distance[bestPath[i]][value]) };
}
