'use client';

import { useState } from 'react';

// --- FULL PENS (21 ITEMS) ---
const PENS_QUESTIONS = [
  // Competence
  { id: 'pens_c1', text: 'I feel highly capable and effective when playing.' },
  { id: 'pens_c2', text: 'I feel a sense of competence playing this game.' },
  { id: 'pens_c3', text: 'My ability to play the game is well matched with the game\'s challenges.' },
  // Autonomy
  { id: 'pens_a1', text: 'The game provides me with interesting options and choices.' },
  { id: 'pens_a2', text: 'I experience a lot of freedom in the game.' },
  { id: 'pens_a3', text: 'The game lets you do interesting things.' },
  // Relatedness (Trimmed down)
  { id: 'pens_r2', text: 'I feel connected to the opponent when playing.' },
  // Intuitive Controls
  { id: 'pens_ic1', text: 'Learning the game controls was easy.' },
  { id: 'pens_ic2', text: 'The game controls are intuitive.' },
  { id: 'pens_ic3', text: 'When I wanted to do something in the game, it was easy to remember the corresponding control.' },
  // Immersion (Trimmed down to focus/visuals)
  { id: 'pens_p3', text: 'The game board feels visually engaging to me.' },
  { id: 'pens_p6', text: 'I become completely focused on the match.' },
];

// --- FOCUSED GEQ CORE (TRIMMED) ---
const GEQ_QUESTIONS = [
  { id: 'geq_1', text: 'I felt content.' },
  { id: 'geq_2', text: 'I felt skilful.' },
  { id: 'geq_3', text: 'I was interested in the game\'s mechanics.' },
  { id: 'geq_4', text: 'I thought it was fun.' },
  { id: 'geq_6', text: 'I felt successful.' },
  { id: 'geq_7', text: 'I felt imaginative.' },
  { id: 'geq_10', text: 'I felt frustrated.' },
  { id: 'geq_11', text: 'I found it tiresome.' },
  { id: 'geq_13', text: 'I felt confident in my moves.' },
  { id: 'geq_14', text: 'I felt bored.' },
  { id: 'geq_15', text: 'I found it challenging.' },
  { id: 'geq_16', text: 'I was fully occupied with the match.' },
  { id: 'geq_20', text: 'I lost track of time.' },
  { id: 'geq_24', text: 'It was aesthetically pleasing.' },
  { id: 'geq_26', text: 'I felt pressured to make the right moves.' },
  { id: 'geq_29', text: 'I felt competent.' },
  { id: 'geq_30', text: 'I felt pressured to act quickly.' },
  { id: 'geq_33', text: 'I found it hard.' }
];

interface Props {
  isOpen: boolean;
  onSubmit: (answers: Record<string, number>) => void;
  onClose: () => void;
}

export default function ExperienceSurvey({ isOpen, onSubmit, onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  if (!isOpen) return null;

  const handleSelect = (id: string, value: number) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const currentQuestions = step === 1 ? PENS_QUESTIONS : GEQ_QUESTIONS;
  const allCurrentAnswered = currentQuestions.every((q) => answers[q.id] !== undefined);

  const handleNextOrSubmit = () => {
    if (!allCurrentAnswered) {
      alert('Please answer all questions before proceeding.');
      return;
    }
    
    if (step === 1) {
      setStep(2);
      // scroll to top
      const scrollArea = document.getElementById('survey-scroll-area');
      if (scrollArea) scrollArea.scrollTop = 0;
    } else {
      onSubmit(answers);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-800 flex-shrink-0 bg-gray-900 rounded-t-2xl">
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
          <h2 className="text-2xl font-bold text-white mb-2">
            Game Experience Survey (Player Feedback)
          </h2>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span className={step === 1 ? 'text-blue-400 font-bold' : ''}>Part 1: PENS (Needs Satisfaction)</span>
            <span>→</span>
            <span className={step === 2 ? 'text-blue-400 font-bold' : ''}>Part 2: GEQ (Game Experience)</span>
          </div>
        </div>

        {/* Scrollable Content */}
        <div id="survey-scroll-area" className="p-6 overflow-y-auto flex-1 custom-scrollbar scroll-smooth">
          <div className="mb-6 bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl text-blue-200 text-sm">
            Please indicate how much you agree or disagree with each statement based on the match you just played.<br />
            (1 = Strongly Disagree, 7 = Strongly Agree)
          </div>

          <div className="space-y-4">
            {currentQuestions.map((q, idx) => (
              <div key={q.id} className="bg-white/5 p-5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                <p className="text-white mb-4 font-medium text-lg">
                  <span className="text-blue-400 mr-2">{idx + 1}.</span> 
                  {q.text}
                </p>
                <div className="flex justify-between items-center max-w-2xl mx-auto gap-2">
                  <span className="text-xs text-gray-500 w-16 mx-1 sm:w-24 text-right leading-tight">Strongly Disagree</span>
                  <div className="flex gap-1 sm:gap-2">
                  {[1, 2, 3, 4, 5, 6, 7].map((val) => (
                    <label 
                      key={val} 
                      className={`
                        w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center cursor-pointer border-2 transition-all font-bold text-sm sm:text-base
                        ${answers[q.id] === val 
                          ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)] scale-110' 
                          : 'bg-black/50 border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800'}
                      `}
                    >
                      <input 
                        type="radio" 
                        name={q.id} 
                        value={val} 
                        onChange={() => handleSelect(q.id, val)}
                        className="sr-only"
                      />
                      {val}
                    </label>
                  ))}
                  </div>
                  <span className="text-xs text-gray-500 w-16 mx-1 sm:w-24 leading-tight">Strongly Agree</span>
                 </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-800 flex-shrink-0 flex justify-between items-center bg-gray-900 rounded-b-2xl">
          <div className="text-gray-400 text-sm">
            {Object.keys(answers).length} / {PENS_QUESTIONS.length + GEQ_QUESTIONS.length} Questions Answered
          </div>
          <button 
            onClick={handleNextOrSubmit}
            className={`px-8 py-2.5 rounded-xl font-bold transition-all shadow-lg ${
              allCurrentAnswered 
                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:scale-105' 
                : 'bg-white/10 text-gray-600 cursor-not-allowed border border-white/5'
            }`}
          >
            {step === 1 ? 'Next Part →' : 'Submit Feedback'}
          </button>
        </div>

      </div>
    </div>
  );
}
