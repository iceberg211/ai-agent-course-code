export interface DigitalHumanSessionOffer {
  sessionId: string;
  sdpOffer: RTCSessionDescriptionInit | null;
}

export interface DigitalHumanService {
  createSession(personaId: string): Promise<DigitalHumanSessionOffer>;
  setAnswer(sessionId: string, sdpAnswer: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(sessionId: string, candidate: RTCIceCandidateInit): Promise<void>;
  onIceCandidate(
    sessionId: string,
    cb: (candidate: RTCIceCandidateInit) => void,
  ): () => void;
  speak(sessionId: string, turnId: string, text: string): Promise<void>;
  interrupt(sessionId: string, turnId?: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
}

interface RTCSessionDescriptionInit {
  type: 'answer' | 'offer' | 'pranswer' | 'rollback';
  sdp?: string;
}

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}
