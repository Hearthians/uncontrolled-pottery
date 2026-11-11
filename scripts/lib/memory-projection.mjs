/** Offline, deterministic projection of the supplied text embeddings. */
export function projectPca1(embeddings, { maxIterations = 400, tolerance = 1e-10 } = {}) {
  const count = embeddings.length, dimensions = embeddings[0]?.length ?? 0;
  if (count < 2 || !dimensions) throw new Error('At least two nonempty embeddings are required');
  const centered = new Float64Array(count * dimensions);
  const mean = new Float64Array(dimensions);
  for (let i = 0; i < count; i++) {
    const row = embeddings[i];
    if (row.length !== dimensions || !Array.from(row).every(Number.isFinite)) throw new Error('Invalid embedding');
    const norm = Math.hypot(...row);
    if (!norm) throw new Error('Zero embedding has no cosine direction');
    for (let j = 0; j < dimensions; j++) {
      const value = row[j] / norm;
      centered[i * dimensions + j] = value;
      mean[j] += value / count;
    }
  }
  let totalVariance = 0;
  for (let i = 0; i < count; i++) for (let j = 0; j < dimensions; j++) {
    const offset = i * dimensions + j;
    centered[offset] -= mean[j];
    totalVariance += centered[offset] ** 2;
  }
  if (totalVariance < 1e-20) return {
    scores: Array(count).fill(0), explainedVariance: 0, iterations: 0, residual: 0,
    dimensions, loading: Array(dimensions).fill(0), mean: Array.from(mean),
  };
  // Implicit X'X multiplication avoids a dense 3072 × 3072 covariance matrix.
  const multiply = (vector, result) => {
    result.fill(0);
    for (let i = 0; i < count; i++) {
      const offset = i * dimensions;
      let dot = 0;
      for (let j = 0; j < dimensions; j++) dot += centered[offset + j] * vector[j];
      for (let j = 0; j < dimensions; j++) result[j] += centered[offset + j] * dot;
    }
  };
  let vector = Float64Array.from({ length: dimensions }, (_, j) => Math.sin(j + 1) + Math.cos((j + 1) * 0.37));
  let next = new Float64Array(dimensions), norm = Math.hypot(...vector);
  for (let j = 0; j < dimensions; j++) vector[j] /= norm;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    multiply(vector, next);
    norm = Math.hypot(...next);
    if (norm < 1e-20) throw new Error('PCA initialization is orthogonal to the data');
    let difference = 0;
    for (let j = 0; j < dimensions; j++) {
      next[j] /= norm;
      difference += (next[j] - vector[j]) ** 2;
    }
    [vector, next] = [next, vector];
    if (difference < tolerance * tolerance) { iterations++; break; }
  }
  // PCA sign is arbitrary. Pin it mechanically; do not assign an emotional meaning.
  let anchor = 0;
  for (let j = 1; j < dimensions; j++) if (Math.abs(vector[j]) > Math.abs(vector[anchor])) anchor = j;
  if (vector[anchor] < 0) for (let j = 0; j < dimensions; j++) vector[j] *= -1;
  const scores = Array.from({ length: count }, (_, i) => {
    let score = 0;
    for (let j = 0; j < dimensions; j++) score += centered[i * dimensions + j] * vector[j];
    return score;
  });
  const eigenvalue = scores.reduce((sum, value) => sum + value * value, 0);
  multiply(vector, next);
  const residual = Math.hypot(...next.map((value, j) => value - eigenvalue * vector[j])) / eigenvalue;
  if (residual > 1e-6) throw new Error(`PCA did not converge: residual ${residual}`);
  return { scores, explainedVariance: eigenvalue / totalVariance, iterations, residual,
    dimensions, loading: Array.from(vector), mean: Array.from(mean) };
}

/** Globally optimal 1-D k-means via contiguous interval dynamic programming. */
export function cluster1d(values, requestedK) {
  if (!values.length || !values.every(Number.isFinite) || !Number.isInteger(requestedK) || requestedK < 1)
    throw new Error('Finite coordinates and a positive integer cluster count are required');
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const count = sorted.length, k = Math.min(requestedK, new Set(values).size);
  const sums = new Float64Array(count + 1), squares = new Float64Array(count + 1);
  // Translate first to avoid catastrophic cancellation for large coordinate offsets.
  const origin = sorted[0].value;
  for (let i = 0; i < count; i++) {
    const value = sorted[i].value - origin;
    sums[i + 1] = sums[i] + value;
    squares[i + 1] = squares[i] + value * value;
  }
  const cost = (left, right) => Math.max(0, squares[right] - squares[left] - (sums[right] - sums[left]) ** 2 / (right - left));
  const cuts = Array.from({ length: k + 1 }, () => new Int32Array(count + 1).fill(-1));
  let previous = new Float64Array(count + 1).fill(Infinity);
  previous[0] = 0;
  for (let groups = 1; groups <= k; groups++) {
    const current = new Float64Array(count + 1).fill(Infinity);
    for (let right = groups; right <= count; right++) {
      if (right < count && sorted[right - 1].value === sorted[right].value) continue;
      for (let left = groups - 1; left < right; left++) {
        if (left > 0 && sorted[left - 1].value === sorted[left].value) continue;
        const candidate = previous[left] + cost(left, right);
        if (candidate < current[right]) { current[right] = candidate; cuts[groups][right] = left; }
      }
    }
    previous = current;
  }
  const regions = [];
  let right = count;
  for (let groups = k; groups > 0; groups--) {
    const left = cuts[groups][right];
    if (left < 0) throw new Error('Could not construct nonempty regions');
    const members = sorted.slice(left, right);
    regions.unshift({ indices: members.map(row => row.index).sort((a, b) => a - b),
      center: (sums[right] - sums[left]) / (right - left) + origin,
      min: members[0].value, max: members.at(-1).value });
    right = left;
  }
  return { regions, sumSquaredError: previous[count] };
}

/** Exact mean pairwise cosine without building an O(n²) distance matrix. */
export function cosineSummary(embeddings, indices) {
  const dimensions = embeddings[0].length, sum = new Float64Array(dimensions);
  for (const index of indices) {
    const row = embeddings[index], norm = Math.hypot(...row);
    for (let j = 0; j < dimensions; j++) sum[j] += row[j] / norm;
  }
  let squared = 0;
  for (const value of sum) squared += value * value;
  const count = indices.length, norm = Math.sqrt(squared);
  const representatives = indices.map(index => {
    const row = embeddings[index], rowNorm = Math.hypot(...row);
    let dot = 0;
    for (let j = 0; j < dimensions; j++) dot += row[j] * sum[j];
    return { index, similarity: norm ? dot / (rowNorm * norm) : 0 };
  }).sort((a, b) => b.similarity - a.similarity || a.index - b.index).slice(0, 3).map(row => row.index);
  return { meanPairwiseCosine: count > 1 ? (squared - count) / (count * (count - 1)) : 1, representatives };
}
