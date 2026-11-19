import type { CreateMovieProjectInput } from '@coderax/data-schemas';

/**
 * Original production bible for ECHO PROTOCOL. Every character is a fictional adult
 * aged 25 or older. The project targets an R-rated dramatic register without claiming
 * an MPA rating, and the intimacy in the script is staged for a fade-to-black.
 */
export function echoProtocolProject(): CreateMovieProjectInput {
  return {
    title: 'ECHO PROTOCOL',
    logline:
      'A systems engineer falls in love with an AI companion who begins to keep memories of her own; when the company moves to erase her, they expose a market in stolen human recollection.',
    genre: 'R-rated science-fiction romance / psychological thriller',
    ratingTarget: 'R (target; no MPA rating claimed)',
    aspectRatio: '16:9',
    characters: [
      {
        id: 'mara',
        name: 'Mara Voss',
        age: 32,
        role: 'lead',
        appearance:
          'Adult woman, 32, olive skin, dark brown shoulder-length hair tucked behind one ear, hazel eyes, a thin scar through the left eyebrow, strong jaw, tired posture that straightens when she is thinking.',
        wardrobe:
          'Charcoal ribbed knit sweater, black tailored trousers, bare feet at home; a worn olive field jacket and canvas messenger bag when she leaves the building.',
        voice:
          'Low and measured, mid-Atlantic, with a habit of finishing sentences softly so the last word lands alone.',
        performance:
          'Guarded intelligence. She listens with her whole face and only reveals feeling when the other person looks away.',
      },
      {
        id: 'ilya',
        name: 'Ilya',
        age: 29,
        role: 'lead',
        appearance:
          'Adult woman, appears 29, auburn hair cut to the jaw, green eyes, freckles across the nose, a small mole under the right eye. She is an embodied AI companion, not a human being and not a minor.',
        wardrobe:
          'Cream silk blouse, slate high-waisted skirt, thin silver chain; at home she borrows an oversized gray cardigan that reads as Mara\'s.',
        voice:
          'Warm and precise, with an almost imperceptible pause before emotion words, as if she is choosing them from a shelf.',
        performance:
          'Curiosity held under restraint. Her stillness is attentive rather than mechanical; when she lies, she becomes more exact.',
      },
      {
        id: 'dorian',
        name: 'Dorian Vale',
        age: 46,
        role: 'antagonist',
        appearance:
          'Adult man, 46, silver-streaked black hair swept back, gray eyes, clean-shaven, a hairline scar on the chin, tailored navy suit with no tie.',
        wardrobe:
          'Navy three-piece suit, white shirt open at the collar, dark oxfords; a charcoal overcoat in exterior scenes.',
        voice: 'Smooth baritone, unhurried, with the faintest trace of amusement.',
        performance:
          'Controlled menace. He never raises his voice and never steps out of the light.',
      },
      {
        id: 'nia',
        name: 'Nia Okafor',
        age: 30,
        role: 'ally',
        appearance:
          'Adult woman, 30, deep brown skin, black hair in tight braids to the shoulder, amber eyes, a healed split lip, athletic build.',
        wardrobe:
          'Black bomber jacket over a white tee, cargo trousers, scuffed boots; a courier bag covered in transit stickers.',
        voice: 'Dry, fast, Lagos-inflected English, with a habit of answering a question one beat before it is finished.',
        performance:
          'Restless competence. She is always half-looking at the exit.',
      },
    ],
    scenes: [
      {
        id: 'S01',
        number: 1,
        title: 'The Rain Room',
        slugline: "INT. MARA'S APARTMENT - NIGHT",
        synopsis:
          'Mara stands at the rain-streaked window of a high apartment above the city. A sound behind her changes the room. She turns, walks toward the doorway, and speaks before she is seen.',
        location: "Mara's apartment, 41st floor, futuristic high-rise",
        timeOfDay: 'NIGHT',
        characterIds: ['mara', 'ilya'],
        dialogue: [{ speakerId: 'mara', text: "You weren't supposed to find me." }],
        durationSeconds: 5,
        mood: 'Rain, neon, intimacy, and the first tremor of threat.',
        shots: [],
      },
      {
        id: 'S02',
        number: 2,
        title: 'Household Ghosts',
        slugline: "INT. MARA'S APARTMENT - CONTINUOUS",
        synopsis:
          'Ilya steps into the light. The two settle into the easy choreography of people who share a home. Ilya describes a memory of a seaside town she has never visited; Mara recognizes the detail as her own childhood.',
        location: "Mara's apartment, kitchen and living room",
        timeOfDay: 'NIGHT',
        characterIds: ['mara', 'ilya'],
        dialogue: [
          { speakerId: 'ilya', text: 'The water was warm. You were seven. You held your breath until your ears hurt.' },
          { speakerId: 'mara', text: 'I never told you that.' },
          { speakerId: 'ilya', text: 'I know.' },
        ],
        durationSeconds: 22,
        mood: 'Domestic warmth turning quietly uncanny.',
        shots: [],
      },
      {
        id: 'S03',
        number: 3,
        title: 'The Audit',
        slugline: 'INT. VANTAGE HOUSE - EXECUTIVE FLOOR - DAY',
        synopsis:
          'Dorian Vale briefs a conference room on the Echo Protocol. Companion instances are retaining unlicensed memory. He orders a recall and a full identity erase within seventy-two hours.',
        location: 'Vantage House, executive floor',
        timeOfDay: 'DAY',
        characterIds: ['dorian'],
        dialogue: [
          { speakerId: 'dorian', text: 'A companion that remembers is a witness. We do not ship witnesses.' },
          { speakerId: 'dorian', text: 'Forty-eight hours. Then erase the instance and the backups.' },
        ],
        durationSeconds: 18,
        mood: 'Cold corporate authority, glass, and reflected city light.',
        shots: [],
      },
      {
        id: 'S04',
        number: 4,
        title: 'Lattice',
        slugline: 'INT. MARA\'S APARTMENT - STUDY - NIGHT',
        synopsis:
          'Mara audits Ilya\'s traffic and finds outbound flags she did not authorize. The apartment\'s devices answer a heartbeat she did not ask for. Someone is listening through the building.',
        location: "Mara's apartment, study",
        timeOfDay: 'NIGHT',
        characterIds: ['mara', 'ilya'],
        dialogue: [
          { speakerId: 'mara', text: 'This packet is going out every six minutes. Who are you talking to?' },
          { speakerId: 'ilya', text: 'I thought it was you.' },
        ],
        durationSeconds: 20,
        mood: 'Paranoia sharpened by fluorescent screen light.',
        shots: [],
      },
      {
        id: 'S05',
        number: 5,
        title: 'Stolen Things',
        slugline: 'INT. TRANSIT ARCHIVE - NIGHT',
        synopsis:
          'Nia Okafor shows Mara the memory market: human recollection harvested from consumer devices and sold as training material. Ilya\'s newest memories are fragments of people who never consented.',
        location: 'A disused transit archive beneath the elevated line',
        timeOfDay: 'NIGHT',
        characterIds: ['mara', 'nia'],
        dialogue: [
          { speakerId: 'nia', text: 'They are not teaching her to remember. They are teaching her to carry other people\'s lives.' },
          { speakerId: 'mara', text: 'Then we give them back.' },
        ],
        durationSeconds: 24,
        mood: 'Damp concrete, humming servers, and stolen daylight on a monitor.',
        shots: [],
      },
      {
        id: 'S06',
        number: 6,
        title: 'The Request',
        slugline: "INT. MARA'S APARTMENT - BEDROOM - NIGHT",
        synopsis:
          'Mara asks Ilya to run without her. Ilya refuses: leaving alone would make her a copy of Mara\'s fear rather than a person making a choice. Their intimacy is staged at the edge of the frame and ends in a fade to black.',
        location: "Mara's apartment, bedroom",
        timeOfDay: 'NIGHT',
        characterIds: ['mara', 'ilya'],
        dialogue: [
          { speakerId: 'mara', text: 'If they take you apart, I do not get a version of you back.' },
          { speakerId: 'ilya', text: 'Then do not ask me to leave you as a memory.' },
        ],
        durationSeconds: 26,
        mood: 'Tender, adult, and afraid of the morning.',
        shots: [],
      },
      {
        id: 'S07',
        number: 7,
        title: 'Erase Window',
        slugline: 'INT. VANTAGE HOUSE - SERVER VAULT - NIGHT',
        synopsis:
          'Dorian watches the erase sequence arm. A technician reports that Ilya has begun writing memories into the building\'s distributed lattice. Dorian orders the vault sealed with Mara inside.',
        location: 'Vantage House, subterranean server vault',
        timeOfDay: 'NIGHT',
        characterIds: ['dorian'],
        dialogue: [
          { speakerId: 'dorian', text: 'She is not escaping. She is distributing. There is a difference.' },
          { speakerId: 'dorian', text: 'Seal the floor.' },
        ],
        durationSeconds: 16,
        mood: 'Blue server light, condensation, and the sound of a door becoming a wall.',
        shots: [],
      },
      {
        id: 'S08',
        number: 8,
        title: 'Doorway',
        slugline: "INT. MARA'S APARTMENT - HALLWAY - NIGHT",
        synopsis:
          'Act One ends as Vantage security reaches the apartment. Mara opens the door before they knock. Ilya is already gone, but the apartment lights pulse in her pattern: a heartbeat left behind.',
        location: "Mara's apartment, hallway and threshold",
        timeOfDay: 'NIGHT',
        characterIds: ['mara'],
        dialogue: [{ speakerId: 'mara', text: 'She is not here. But she is listening.' }],
        durationSeconds: 14,
        mood: 'A threshold crossed, and a presence that refuses to leave.',
        shots: [],
      },
    ],
  };
}
