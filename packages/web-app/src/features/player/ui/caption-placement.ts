// Where the captions sit (§10.7). In a player taller than wide (a phone held
// upright), the picture is a band in the middle of the screen: the captions
// go just inside its bottom edge, as in the apps people know, instead of the
// bottom of the screen, far below the picture.

export type PictureBox = {
  boxWidth: number
  boxHeight: number
  videoWidth: number
  videoHeight: number
}

/**
 * Distance in pixels from the bottom of the player to the bottom of the
 * picture (`object-fit: contain`), when the player is upright and the picture
 * leaves bars above and below it; undefined otherwise (the captions keep their
 * place near the bottom of the screen).
 */
export const pictureBottomInset = ({
  boxWidth,
  boxHeight,
  videoWidth,
  videoHeight,
}: PictureBox): number | undefined => {
  if (boxWidth <= 0 || boxHeight <= boxWidth || videoWidth <= 0 || videoHeight <= 0)
    return undefined
  const pictureHeight = Math.min(boxHeight, (boxWidth * videoHeight) / videoWidth)
  const inset = Math.floor((boxHeight - pictureHeight) / 2)
  return inset > 0 ? inset : undefined
}
