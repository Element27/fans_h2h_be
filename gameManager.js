import { supabaseAdmin } from './supabaseClient.js';
import { v4 as uuidv4 } from 'uuid';

class GameManager {
  constructor(io) {
    this.io = io;
    this.matches = new Map(); // matchId -> matchState
  }

  async createMatch(player1, player2) {
    const matchId = uuidv4();

    // Fetch questions from DB, fallback to built-in set if unavailable
    const DEFAULT_QUESTIONS = [
      { id: 'q1', question: 'Which club has more UCL titles?', options: ['FC Barcelona', 'Real Madrid', 'AC Milan', 'Bayern Munich'], correct_index: 1 },
      { id: 'q2', question: 'Which league is Arsenal in?', options: ['La Liga', 'Bundesliga', 'Premier League', 'Serie A'], correct_index: 2 },
      { id: 'q3', question: 'PSG home city is?', options: ['Madrid', 'Paris', 'Rome', 'Munich'], correct_index: 1 },
      { id: 'q4', question: 'Der Klassiker is between?', options: ['Ajax vs PSV', 'Juventus vs Inter', 'Bayern vs Dortmund', 'Chelsea vs Arsenal'], correct_index: 2 },
      { id: 'q5', question: 'Which club is nicknamed Rossoneri?', options: ['AC Milan', 'Inter Milan', 'Juventus', 'Napoli'], correct_index: 0 },
      { id: 'q6', question: 'FC Barcelona plays at?', options: ['Allianz Arena', 'Camp Nou', 'San Siro', 'Anfield'], correct_index: 1 },
      { id: 'q7', question: 'Which club is from Amsterdam?', options: ['Ajax', 'PSV', 'Feyenoord', 'AZ'], correct_index: 0 },
    ];

    let allQuestions = [];
    try {
      const { data, error } = await supabaseAdmin
        .from('questions')
        .select('*');
      if (!error && Array.isArray(data) && data.length > 0) {
        allQuestions = data;
      } else {
        allQuestions = DEFAULT_QUESTIONS;
      }
    } catch (e) {
      allQuestions = DEFAULT_QUESTIONS;
    }

    // Shuffle and pick 5
    const questions = allQuestions.sort(() => 0.5 - Math.random()).slice(0, 5);

    const matchState = {
      id: matchId,
      players: { [player1.socketId]: player1, [player2.socketId]: player2 },
      playerIds: [player1.socketId, player2.socketId],
      questions,
      currentQuestionIndex: 0,
      scores: { [player1.socketId]: 0, [player2.socketId]: 0 },
      answers: {}, // questionIndex -> { playerId: { answer, time } }
      timer: null,
      startTime: null
    };

    this.matches.set(matchId, matchState);

    // Join players to socket room
    this.io.in(player1.socketId).socketsJoin(matchId);
    this.io.in(player2.socketId).socketsJoin(matchId);

    // Notify players individually with opponent object
    this.io.to(player1.socketId).emit('match_found', {
      matchId,
      opponent: player2.user
    });
    this.io.to(player2.socketId).emit('match_found', {
      matchId,
      opponent: player1.user
    });

    // Start first question after delay
    setTimeout(() => this.startQuestion(matchId), 3000);
  }

  startQuestion(matchId) {
    const match = this.matches.get(matchId);
    if (!match) return;

    const question = match.questions[match.currentQuestionIndex];
    match.startTime = Date.now();
    match.answers[match.currentQuestionIndex] = {};

    this.io.to(matchId).emit('new_question', {
      question: {
        id: question.id,
        question: question.question,
        options: question.options
      },
      index: match.currentQuestionIndex + 1,
      total: match.questions.length,
      endTime: Date.now() + 10000 // 10 seconds
    });

    // Server-side timeout
    match.timer = setTimeout(() => {
      this.endQuestion(matchId);
    }, 11000); // 10s + 1s buffer
  }

  handleAnswer(matchId, socketId, answerIndex) {
    const match = this.matches.get(matchId);
    if (!match) return;

    // Check if already answered
    if (match.answers[match.currentQuestionIndex][socketId]) return;

    const timeTaken = (Date.now() - match.startTime) / 1000;
    const remainingTime = Math.max(0, 10 - timeTaken);

    const question = match.questions[match.currentQuestionIndex];
    const isCorrect = answerIndex === question.correct_index;

    let score = 0;
    if (isCorrect) {
      score = Math.round(100 + (remainingTime * 5));
    }

    match.scores[socketId] += score;
    match.answers[match.currentQuestionIndex][socketId] = {
      answerIndex,
      isCorrect,
      score
    };

    // Check if both answered
    const answeredCount = Object.keys(match.answers[match.currentQuestionIndex]).length;
    if (answeredCount === 2) {
      clearTimeout(match.timer);
      this.endQuestion(matchId);
    }
  }

  endQuestion(matchId) {
    const match = this.matches.get(matchId);
    if (!match) return;

    // Send results for this question
    const currentAnswers = match.answers[match.currentQuestionIndex];
    const question = match.questions[match.currentQuestionIndex];

    this.io.to(matchId).emit('question_result', {
      correctIndex: question.correct_index,
      scores: match.scores,
      answers: currentAnswers
    });

    match.currentQuestionIndex++;

    if (match.currentQuestionIndex < match.questions.length) {
      setTimeout(() => this.startQuestion(matchId), 3000);
    } else {
      setTimeout(() => this.endMatch(matchId), 3000);
    }
  }

  async endMatch(matchId) {
    const match = this.matches.get(matchId);
    if (!match) return;

    const p1Id = match.playerIds[0];
    const p2Id = match.playerIds[1];

    const p1 = match.players[p1Id];
    const p2 = match.players[p2Id];

    const p1Score = match.scores[p1Id];
    const p2Score = match.scores[p2Id];

    let winnerId = null;
    if (p1Score > p2Score) winnerId = p1.user.id;
    else if (p2Score > p1Score) winnerId = p2.user.id;

    // Save to DB
    const { error } = await supabaseAdmin.from('matches').insert({
      player1_id: p1.user.id,
      player2_id: p2.user.id,
      questions: match.questions,
      p1_score: p1Score,
      p2_score: p2Score,
      winner_id: winnerId
    });

    if (error) console.error('Error saving match:', error);

    this.io.to(matchId).emit('game_over', {
      scores: match.scores,
      winnerId
    });

    this.matches.delete(matchId);
  }

  // Handle disconnect
  handleDisconnect(socketId) {
    // Find active match
    for (const [matchId, match] of this.matches.entries()) {
      if (match.playerIds.includes(socketId)) {
        // End match, other player wins by default? Or just notify.
        // For MVP, just notify opponent.
        this.io.to(matchId).emit('opponent_disconnected');
        this.matches.delete(matchId);
        break;
      }
    }
  }
}

export default GameManager;
