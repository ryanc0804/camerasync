import { useEffect, useRef, useState } from "react";

export function LocalMediaPreview({ disabled, onReady, onDecline }) {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [devices, setDevices] = useState([]);
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  // puts the current stream in the local preview
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // turns off old camera and microphone tracks
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  // asks for the camera and microphone together
  const getMedia = async (
    nextCameraId,
    nextMicrophoneId,
    firstRequest = false
  ) => {
    setRequesting(true);
    setError("");

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: nextCameraId
          ? { deviceId: { exact: nextCameraId } }
          : true,
        audio: nextMicrophoneId
          ? { deviceId: { exact: nextMicrophoneId } }
          : true,
      });

      let availableDevices = [];
      try {
        availableDevices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        // default devices still work without their names
      }

      setStream(nextStream);
      setDevices(availableDevices);
      setCameraId(nextCameraId);
      setMicrophoneId(nextMicrophoneId);
      setAccepted(true);
      onReady(nextStream);
    } catch {
      if (firstRequest) {
        await onDecline();
        return;
      }

      setError("Unable to switch to that device.");
    } finally {
      setRequesting(false);
    }
  };

  const accept = () => getMedia("", "", true);

  // switches the local camera or microphone
  const changeCamera = (event) => {
    const nextCameraId = event.target.value;
    getMedia(nextCameraId, microphoneId);
  };

  const changeMicrophone = (event) => {
    const nextMicrophoneId = event.target.value;
    getMedia(cameraId, nextMicrophoneId);
  };

  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter(
    (device) => device.kind === "audioinput"
  );

  if (!accepted) {
    return (
      <section className="media-permission">
        <style>{mediaCss}</style>
        <h2>Camera and microphone access</h2>
        <p>
          This session needs access to your camera and microphone. You can
          choose different devices after joining.
        </p>
        <div>
          <button type="button" onClick={onDecline} disabled={requesting}>
            Decline
          </button>
          <button
            className="media-accept-button"
            type="button"
            onClick={accept}
            disabled={requesting}
          >
            {requesting ? "Requesting access..." : "Accept"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="local-media">
      <style>{mediaCss}</style>
      <video ref={videoRef} autoPlay muted playsInline />

      <div className="local-media-devices">
        <label>
          Camera
          <select
            value={cameraId}
            onChange={changeCamera}
            disabled={disabled || requesting}
          >
            <option value="">System default</option>
            {cameras.map((camera, index) => (
              <option value={camera.deviceId} key={camera.deviceId}>
                {camera.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        </label>

        <label>
          Microphone
          <select
            value={microphoneId}
            onChange={changeMicrophone}
            disabled={disabled || requesting}
          >
            <option value="">System default</option>
            {microphones.map((microphone, index) => (
              <option value={microphone.deviceId} key={microphone.deviceId}>
                {microphone.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {requesting && <p className="local-media-note">Switching device...</p>}
      {error && <p className="local-media-error">{error}</p>}
    </section>
  );
}

const mediaCss = `
  .media-permission {
    width: min(100%, 520px);
    margin-top: 2rem;
    padding: 1.5rem;
    border: 1px solid #2d2d2d;
    border-radius: 9px;
    background: #111;
  }
  .media-permission h2 {
    margin: 0 0 0.6rem;
    font-size: 1.1rem;
  }
  .media-permission p {
    margin: 0;
    color: #aaa;
    line-height: 1.5;
  }
  .media-permission div {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1.2rem;
  }
  .media-permission .media-accept-button {
    border-color: #ffc72c;
    background: #ffc72c;
    color: #0d0d0d;
  }
  .local-media {
    min-width: 0;
  }
  .local-media video {
    display: block;
    width: 100%;
    max-height: 62vh;
    aspect-ratio: 16 / 9;
    border: 1px solid #272727;
    border-radius: 9px;
    background: #111;
    object-fit: cover;
  }
  .local-media-devices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
    margin-top: 0.9rem;
  }
  .local-media-devices label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: #aaa;
    font-size: 0.8rem;
  }
  .local-media-devices select {
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid #383838;
    border-radius: 7px;
    background: #171717;
    color: #eee;
    font: inherit;
  }
  .local-media-note,
  .local-media-error {
    margin: 0.6rem 0 0;
    color: #888;
    font-size: 0.8rem;
  }
  .local-media-error {
    color: #ffaaa5;
  }
  @media (max-width: 650px) {
    .local-media-devices {
      grid-template-columns: 1fr;
    }
  }
`;
