const ARUCO_PATTERNS = {
  0:[1,0,1,1,0,1,0,1,0,0,1,1,0,0,1,0],1:[0,0,0,0,1,1,1,1,1,0,0,1,1,0,1,0],2:[0,0,1,1,0,0,1,1,0,0,1,0,1,1,0,1],3:[1,0,0,1,1,0,0,1,0,1,0,0,0,1,1,0],
  10:[1,1,1,1,1,0,0,1,1,0,0,1,0,0,0,1],11:[0,0,0,1,0,0,0,1,1,0,1,0,0,1,1,1],12:[0,0,0,0,1,1,1,0,1,0,1,1,0,1,1,1],13:[0,0,1,0,1,0,1,0,0,0,0,0,1,1,1,1],
  20:[1,0,0,0,0,1,1,0,1,0,0,0,1,0,1,1],21:[1,0,1,1,0,0,0,0,0,0,1,0,1,0,1,1],22:[1,1,0,0,1,1,0,0,1,1,0,1,0,1,0,1],23:[1,1,0,1,1,1,0,1,1,0,0,0,0,0,1,0],
  30:[0,1,0,0,0,1,0,0,0,0,0,1,0,1,0,1],31:[0,1,0,1,0,1,1,1,1,0,1,1,0,0,1,0],32:[1,0,0,1,1,1,1,0,1,1,0,0,1,1,1,1],33:[1,1,1,1,0,0,0,0,1,1,0,0,1,0,1,1],
  40:[0,0,0,1,0,1,1,1,0,0,0,1,1,0,0,0],41:[0,0,1,0,1,0,1,0,0,0,1,0,1,0,0,0],42:[0,0,1,1,0,0,1,0,1,0,0,0,1,1,0,0],43:[0,0,1,1,1,0,0,0,1,0,1,1,0,0,1,0],
};

function rotateBits(bits) {
  const rotated = Array(16);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) rotated[y * 4 + x] = bits[(3 - x) * 4 + y];
  return rotated;
}

function decodeBits(bits) {
  let current = bits;
  let best = null;
  for (let rotation = 0; rotation < 4; rotation += 1) {
    for (const [id, pattern] of Object.entries(ARUCO_PATTERNS)) {
      const distance = current.reduce((sum, bit, index) => sum + (bit !== pattern[index]), 0);
      if (!best || distance < best.distance) best = { id: Number(id), distance, rotation };
    }
    current = rotateBits(current);
  }
  return best;
}

function interpolateQuad(quad, u, v) {
  const [tl, tr, br, bl] = quad;
  return {
    x: (1-u)*(1-v)*tl.x + u*(1-v)*tr.x + u*v*br.x + (1-u)*v*bl.x,
    y: (1-u)*(1-v)*tl.y + u*(1-v)*tr.y + u*v*br.y + (1-u)*v*bl.y,
  };
}

function sampleCandidate(gray, width, height, quad, threshold) {
  const cells = [];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const point = interpolateQuad(quad, (column + .5) / 6, (row + .5) / 6);
      const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
      const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
      cells.push(gray[y * width + x] > threshold ? 1 : 0);
    }
  }
  let borderErrors = 0;
  for (let row = 0; row < 6; row += 1) for (let column = 0; column < 6; column += 1) {
    if ((row === 0 || row === 5 || column === 0 || column === 5) && cells[row * 6 + column] !== 0) borderErrors += 1;
  }
  if (borderErrors > 2) return null;
  const inner = [];
  for (let row = 1; row < 5; row += 1) for (let column = 1; column < 5; column += 1) inner.push(cells[row * 6 + column]);
  return decodeBits(inner);
}

export function detectArucoMarkers(canvas) {
  const source = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const width = canvas.width, height = canvas.height;
  const gray = new Uint8Array(width * height);
  let mean = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    gray[i] = Math.round(source.data[offset] * .299 + source.data[offset + 1] * .587 + source.data[offset + 2] * .114);
    mean += gray[i];
  }
  mean /= gray.length;
  const threshold = Math.max(65, Math.min(145, mean * .55));
  const dark = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) dark[i] = gray[i] < threshold ? 1 : 0;
  const visited = new Uint8Array(gray.length);
  const markers = [];
  const minimumSide = Math.max(16, Math.min(width, height) * .025);
  const maximumSide = Math.min(width, height) * .25;

  for (let seed = 0; seed < dark.length; seed += 1) {
    if (!dark[seed] || visited[seed]) continue;
    const queue = [seed]; visited[seed] = 1;
    let cursor = 0, count = 0, minX = width, maxX = 0, minY = height, maxY = 0;
    let tl = null, tr = null, br = null, bl = null;
    while (cursor < queue.length) {
      const index = queue[cursor++], x = index % width, y = Math.floor(index / width); count += 1;
      minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y);
      if (!tl || x+y < tl.x+tl.y) tl={x,y}; if (!br || x+y > br.x+br.y) br={x,y};
      if (!tr || x-y > tr.x-tr.y) tr={x,y}; if (!bl || x-y < bl.x-bl.y) bl={x,y};
      const neighbors = [index-1,index+1,index-width,index+width];
      for (const next of neighbors) {
        if (next < 0 || next >= dark.length || visited[next] || !dark[next]) continue;
        if ((next === index-1 && x === 0) || (next === index+1 && x === width-1)) continue;
        visited[next]=1; queue.push(next);
      }
    }
    const boxWidth=maxX-minX+1, boxHeight=maxY-minY+1, ratio=boxWidth/boxHeight, fill=count/(boxWidth*boxHeight);
    if (boxWidth < minimumSide || boxHeight < minimumSide || boxWidth > maximumSide || boxHeight > maximumSide || ratio < .65 || ratio > 1.35 || fill < .18 || fill > .82) continue;
    const decoded = sampleCandidate(gray,width,height,[tl,tr,br,bl],threshold);
    if (!decoded) continue;
    const id = decoded.distance <= 2 ? decoded.id : null;
    if (id === null || !markers.some(marker => marker.id === id)) markers.push({ id, guessedId:decoded.id, distance:decoded.distance, side:(boxWidth+boxHeight)/2, corners:[tl,tr,br,bl], center:{x:(minX+maxX)/2,y:(minY+maxY)/2} });
  }
  return markers;
}

function solveLinear(matrix, vector) {
  const n=vector.length, augmented=matrix.map((row,index)=>[...row,vector[index]]);
  for (let column=0; column<n; column+=1) {
    let pivot=column; for (let row=column+1; row<n; row+=1) if (Math.abs(augmented[row][column])>Math.abs(augmented[pivot][column])) pivot=row;
    [augmented[column],augmented[pivot]]=[augmented[pivot],augmented[column]];
    const divisor=augmented[column][column]; if (Math.abs(divisor)<1e-9) return null;
    for (let x=column; x<=n; x+=1) augmented[column][x]/=divisor;
    for (let row=0; row<n; row+=1) if (row!==column) { const factor=augmented[row][column]; for (let x=column; x<=n; x+=1) augmented[row][x]-=factor*augmented[column][x]; }
  }
  return augmented.map(row=>row[n]);
}

function homography(from, to) {
  const matrix=[], vector=[];
  for (let i=0;i<4;i+=1) { const {x,y}=from[i], X=to[i].x, Y=to[i].y; matrix.push([x,y,1,0,0,0,-X*x,-X*y]); vector.push(X); matrix.push([0,0,0,x,y,1,-Y*x,-Y*y]); vector.push(Y); }
  const h=solveLinear(matrix,vector); return h ? [...h,1] : null;
}

export function rectifyFromMarkers(sourceCanvas, orderedMarkers, outputCanvas) {
  const width=1200, height=Math.round(width*900/1400);
  const target=[{x:0,y:0},{x:width-1,y:0},{x:width-1,y:height-1},{x:0,y:height-1}];
  const inverse=homography(target,orderedMarkers.map(marker=>marker.center));
  if (!inverse) return false;
  const input=sourceCanvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
  outputCanvas.width=width; outputCanvas.height=height;
  const output=outputCanvas.getContext("2d").createImageData(width,height);
  for (let y=0;y<height;y+=1) for (let x=0;x<width;x+=1) {
    const denominator=inverse[6]*x+inverse[7]*y+1;
    const sx=Math.round((inverse[0]*x+inverse[1]*y+inverse[2])/denominator), sy=Math.round((inverse[3]*x+inverse[4]*y+inverse[5])/denominator), out=(y*width+x)*4;
    if (sx>=0&&sx<sourceCanvas.width&&sy>=0&&sy<sourceCanvas.height) { const from=(sy*sourceCanvas.width+sx)*4; output.data[out]=input.data[from]; output.data[out+1]=input.data[from+1]; output.data[out+2]=input.data[from+2]; output.data[out+3]=255; }
    else output.data[out]=output.data[out+1]=output.data[out+2]=output.data[out+3]=255;
  }
  outputCanvas.getContext("2d").putImageData(output,0,0); return true;
}
