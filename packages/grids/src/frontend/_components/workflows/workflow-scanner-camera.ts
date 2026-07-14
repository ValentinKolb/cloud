const scannerCameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

export const stopScannerStream = (stream: MediaStream): void => {
  stream.getTracks().forEach((track) => track.stop());
};

export const acquireScannerStream = async (
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  isDisposed: () => boolean,
): Promise<MediaStream | null> => {
  const acquired = await getUserMedia(scannerCameraConstraints);
  if (!isDisposed()) return acquired;
  stopScannerStream(acquired);
  return null;
};
