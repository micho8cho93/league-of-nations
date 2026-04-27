/**
 * Music manager for League of Nations
 * Handles playlist management, transitions between normal and battle music
 */

export class MusicManager {
  constructor() {
    this.bgAudioElement = document.getElementById("bg-music");
    this.battleAudioElement = document.getElementById("battle-music");

    this.bgPlaylist = [
      "./bg_music/u_24tqznbjah-ancient-civilisations-507188.mp3",
      "./bg_music/iuvenis-cenizas-del-castigo-infinito-509230.mp3",
      "./bg_music/junipersona-civilization-440796.mp3",
      "./bg_music/melodierealm-secrets-of-the-forgotten-453719.mp3",
      "./bg_music/openmindaudio-documentary-history-underscore-empires-amp-ruins-459848.mp3",
      "./bg_music/openmindaudio-documentary-history-underscore-ancient-chronicle-459847.mp3",
    ];

    this.battlePlaylist = [
      "./battle music/freepik-crimson-battlecry.mp3",
      "./battle music/freepik-guardian-of-the-grove.mp3",
      "./battle music/freepik-myth-within-fire.mp3",
      "./battle music/freepik-suona-frontline.mp3",
      "./battle music/vifotofreesounds-majestic-empire-486751.mp3",
    ];

    this.currentBgIndex = 0;
    this.currentBattleIndex = 0;
    this.isInBattle = false;
    this.isMuted = false;

    // Set up event listeners for playlist cycling
    this.bgAudioElement.addEventListener("ended", () => this.playNextBgTrack());
    this.battleAudioElement.addEventListener("ended", () => this.playNextBattleTrack());

    // Set up volume control
    this.bgAudioElement.volume = 0.5;
    this.battleAudioElement.volume = 0.5;
  }

  /**
   * Start background music playback
   */
  startBackgroundMusic() {
    if (this.isInBattle) return;
    this.battleAudioElement.pause();
    this.playNextBgTrack();
  }

  /**
   * Start battle music playback
   */
  startBattleMusic() {
    this.isInBattle = true;
    this.bgAudioElement.pause();
    this.playNextBattleTrack();
  }

  /**
   * Return to background music
   */
  stopBattleMusic() {
    this.isInBattle = false;
    this.battleAudioElement.pause();
    this.playNextBgTrack();
  }

  /**
   * Play next track in background playlist
   */
  playNextBgTrack() {
    if (this.isInBattle) return;
    this.bgAudioElement.src = this.bgPlaylist[this.currentBgIndex];
    this.bgAudioElement.play();
    this.currentBgIndex = (this.currentBgIndex + 1) % this.bgPlaylist.length;
  }

  /**
   * Play next track in battle playlist
   */
  playNextBattleTrack() {
    if (!this.isInBattle) return;
    this.battleAudioElement.src = this.battlePlaylist[this.currentBattleIndex];
    this.battleAudioElement.play();
    this.currentBattleIndex = (this.currentBattleIndex + 1) % this.battlePlaylist.length;
  }

  /**
   * Toggle mute/unmute
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    this.bgAudioElement.muted = this.isMuted;
    this.battleAudioElement.muted = this.isMuted;
    return this.isMuted;
  }

  /**
   * Set volume level (0-1)
   */
  setVolume(level) {
    const volume = Math.max(0, Math.min(1, level));
    this.bgAudioElement.volume = volume;
    this.battleAudioElement.volume = volume;
  }

  /**
   * Stop all music
   */
  stopAll() {
    this.bgAudioElement.pause();
    this.battleAudioElement.pause();
  }
}

/**
 * Detect if a player is currently in an active battle
 * @param {GameState} game - The game state
 * @param {string} playerId - The player's nation ID
 * @returns {boolean} True if player has active wars
 */
export function isPlayerInBattle(game, playerId) {
  if (!game || !game.nations || !playerId) return false;
  if (!game.wars) return false;

  // Check if player has any active wars
  // Wars are stored as an object, so we need to iterate over values
  for (const war of Object.values(game.wars)) {
    if (war.active && (war.attackerId === playerId || war.defenderId === playerId)) {
      return true;
    }
  }

  return false;
}
