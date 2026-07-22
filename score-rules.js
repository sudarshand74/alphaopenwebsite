export function isStandardSet(winnerGames, loserGames) {
  return (winnerGames === 6 && loserGames <= 4) ||
    (winnerGames === 7 && (loserGames === 5 || loserGames === 6));
}

export function isTiebreakTo12(winnerPoints, loserPoints) {
  return winnerPoints >= 12 && winnerPoints - loserPoints >= 2;
}

function setWinner(set, allowTiebreakTo12) {
  const home = Number(set.home);
  const away = Number(set.away);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home === away) return null;
  const high = Math.max(home, away);
  const low = Math.min(home, away);
  if (!isStandardSet(high, low) && !(allowTiebreakTo12 && isTiebreakTo12(high, low))) return null;
  return home > away ? "home" : "away";
}

export function calculateMatchScore(sets) {
  if (!Array.isArray(sets) || (sets.length !== 2 && sets.length !== 3)) return null;
  const firstWinner = setWinner(sets[0], false);
  const secondWinner = setWinner(sets[1], false);
  if (!firstWinner || !secondWinner) return null;

  if (sets.length === 2) {
    if (firstWinner !== secondWinner) return null;
    const loserSide = firstWinner === "home" ? "away" : "home";
    const loserGames = Number(sets[0][loserSide]) + Number(sets[1][loserSide]);
    const loserPoints = Math.max(2, Math.min(8, loserGames));
    return firstWinner === "home"
      ? { homePoints: 14, awayPoints: loserPoints, winnerSide: "home" }
      : { homePoints: loserPoints, awayPoints: 14, winnerSide: "away" };
  }

  if (firstWinner === secondWinner) return null;
  const thirdWinner = setWinner(sets[2], true);
  if (!thirdWinner) return null;
  return thirdWinner === "home"
    ? { homePoints: 14, awayPoints: 10, winnerSide: "home" }
    : { homePoints: 10, awayPoints: 14, winnerSide: "away" };
}
