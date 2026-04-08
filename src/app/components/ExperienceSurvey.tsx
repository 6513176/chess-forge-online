'use client';

import { useState } from 'react';

// --- FULL PENS (21 ITEMS) ---
const PENS_QUESTIONS = [
  // Competence (3 items)
  { id: 'pens_c1', text: 'I feel competent at the game.' },
  { id: 'pens_c2', text: 'I feel very capable and effective when playing.' },
  { id: 'pens_c3', text: 'My ability to play the game is well matched with the game\'s challenges.' },
  // Autonomy (3 items)
  { id: 'pens_a1', text: 'The game provides me with interesting options and choices.' },
  { id: 'pens_a2', text: 'The game lets you do interesting things.' },
  { id: 'pens_a3', text: 'I experienced a lot of freedom in the game.' },
  // Relatedness (3 items)
  { id: 'pens_r1', text: 'I find the relationships I form in this game fulfilling.' },
  { id: 'pens_r2', text: 'I find the relationships I form in this game important.' },
  { id: 'pens_r3', text: 'I don\'t feel close to other players. (-)' },
  // Presence / Immersion (9 items)
  { id: 'pens_p1', text: 'When playing the game, I feel transported to another time and place.' },
  { id: 'pens_p2', text: 'Exploring the game world feels like taking an actual trip to a new place.' },
  { id: 'pens_p3', text: 'When moving through the game world I feel as if I am actually there.' },
  { id: 'pens_p4', text: 'I am not impacted emotionally by events in the game. (-)' },
  { id: 'pens_p5', text: 'The game was emotionally engaging.' },
  { id: 'pens_p6', text: 'I experience feelings as deeply in the game as I have in real life.' },
  { id: 'pens_p7', text: 'When playing the game I feel as if I was part of the story.' },
  { id: 'pens_p8', text: 'When I accomplished something in the game I experienced genuine pride.' },
  { id: 'pens_p9', text: 'I had reactions to events and characters in the game as if they were real.' },
  // Intuitive Controls (3 items)
  { id: 'pens_ic1', text: 'Learning the game controls was easy.' },
  { id: 'pens_ic2', text: 'The game controls are intuitive.' },
  { id: 'pens_ic3', text: 'When I wanted to do something in the game, it was easy to remember the corresponding control.' },
];

// --- FULL GEQ CORE MODULE (33 ITEMS) ---
const GEQ_QUESTIONS = [
  { id: 'geq_1',  text: 'I felt content.' },
  { id: 'geq_2',  text: 'I felt skilful.' },
  { id: 'geq_3',  text: 'I was interested in the game\'s story.' },
  { id: 'geq_4',  text: 'I thought it was fun.' },
  { id: 'geq_5',  text: 'I was fully occupied with the game.' },
  { id: 'geq_6',  text: 'I felt happy.' },
  { id: 'geq_7',  text: 'It gave me a bad mood.' },
  { id: 'geq_8',  text: 'I thought about other things.' },
  { id: 'geq_9',  text: 'I found it tiresome.' },
  { id: 'geq_10', text: 'I felt competent.' },
  { id: 'geq_11', text: 'I thought it was hard.' },
  { id: 'geq_12', text: 'It was aesthetically pleasing.' },
  { id: 'geq_13', text: 'I forgot everything around me.' },
  { id: 'geq_14', text: 'I felt good.' },
  { id: 'geq_15', text: 'I was good at it.' },
  { id: 'geq_16', text: 'I felt bored.' },
  { id: 'geq_17', text: 'I felt successful.' },
  { id: 'geq_18', text: 'I felt imaginative.' },
  { id: 'geq_19', text: 'I felt that I could explore things.' },
  { id: 'geq_20', text: 'I enjoyed it.' },
  { id: 'geq_21', text: 'I was fast at reaching the game\'s targets.' },
  { id: 'geq_22', text: 'I felt annoyed.' },
  { id: 'geq_23', text: 'I felt pressured.' },
  { id: 'geq_24', text: 'I felt irritable.' },
  { id: 'geq_25', text: 'I lost track of time.' },
  { id: 'geq_26', text: 'I felt challenged.' },
  { id: 'geq_27', text: 'I found it impressive.' },
  { id: 'geq_28', text: 'I was deeply concentrated in the game.' },
  { id: 'geq_29', text: 'I felt frustrated.' },
  { id: 'geq_30', text: 'It felt like a rich experience.' },
  { id: 'geq_31', text: 'I lost connection with the outside world.' },
  { id: 'geq_32', text: 'I felt time pressure.' },
  { id: 'geq_33', text: 'I had to put a lot of effort into it.' },
];

interface Props {
  isOpen: boolean;
  onSubmit: (answers: Record<string, any>) => void;
  onClose: () => void;
}

export default function ExperienceSurvey({ isOpen, onSubmit, onClose }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});

  if (!isOpen) return null;

  const handleSelect = (id: string, value: any) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const currentQuestions = step === 1 ? PENS_QUESTIONS : (step === 2 ? GEQ_QUESTIONS : []);

  let allCurrentAnswered = false;
  if (step === 0) {
    allCurrentAnswered = !!(answers.firstName && answers.lastName && answers.age && answers.boardGameExp && answers.chessExp);
  } else {
    allCurrentAnswered = currentQuestions.every((q) => answers[q.id] !== undefined);
  }

  const handleNextOrSubmit = () => {
    if (!allCurrentAnswered) {
      alert('Please complete all fields before proceeding.');
      return;
    }
    
    if (step === 0) {
      setStep(1);
      const scrollArea = document.getElementById('survey-scroll-area');
      if (scrollArea) scrollArea.scrollTop = 0;
    } else if (step === 1) {
      setStep(2);
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
          <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-400 flex-wrap">
            <span className={step === 0 ? 'text-blue-400 font-bold' : ''}>Intro: Demographics (5)</span>
            <span>→</span>
            <span className={step === 1 ? 'text-blue-400 font-bold' : ''}>Part 1: PENS (21)</span>
            <span>→</span>
            <span className={step === 2 ? 'text-blue-400 font-bold' : ''}>Part 2: GEQ (33)</span>
          </div>
        </div>

        {/* Scrollable Content */}
        <div id="survey-scroll-area" className="p-6 overflow-y-auto flex-1 custom-scrollbar scroll-smooth">
          {step === 0 && (
            <div className="max-w-xl mx-auto space-y-5">
              <div className="mb-4 bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl text-blue-200 text-sm">
                Please answer a few questions about yourself before proceeding to the game experience survey.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/5 p-5 rounded-xl border border-white/5">
                  <label className="block text-white mb-2 font-medium">First Name</label>
                  <input
                    type="text"
                    value={answers.firstName || ''}
                    onChange={(e) => handleSelect('firstName', e.target.value)}
                    placeholder="Enter your first name"
                    className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div className="bg-white/5 p-5 rounded-xl border border-white/5">
                  <label className="block text-white mb-2 font-medium">Last Name</label>
                  <input
                    type="text"
                    value={answers.lastName || ''}
                    onChange={(e) => handleSelect('lastName', e.target.value)}
                    placeholder="Enter your last name"
                    className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div className="bg-white/5 p-5 rounded-xl border border-white/5">
                <label className="block text-white mb-2 font-medium">Age</label>
                <select
                  value={answers.age || ''}
                  onChange={(e) => handleSelect('age', e.target.value)}
                  className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none"
                >
                  <option value="" disabled>Select option</option>
                  <option value="<18">Under 18</option>
                  <option value="18-24">18-24 years</option>
                  <option value="25-34">25-34 years</option>
                  <option value="35-44">35-44 years</option>
                  <option value=">=45">45 years and older</option>
                </select>
              </div>

              <div className="bg-white/5 p-5 rounded-xl border border-white/5">
                <label className="block text-white mb-2 font-medium">How frequently do you play board games?</label>
                <select
                  value={answers.boardGameExp || ''}
                  onChange={(e) => handleSelect('boardGameExp', e.target.value)}
                  className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none"
                >
                  <option value="" disabled>Select option</option>
                  <option value="never">Never</option>
                  <option value="rarely">Rarely</option>
                  <option value="sometimes">Sometimes</option>
                  <option value="often">Often</option>
                  <option value="regularly">Regularly</option>
                </select>
              </div>

              <div className="bg-white/5 p-5 rounded-xl border border-white/5">
                <label className="block text-white mb-2 font-medium">How frequently do you play chess?</label>
                <select
                  value={answers.chessExp || ''}
                  onChange={(e) => handleSelect('chessExp', e.target.value)}
                  className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none"
                >
                  <option value="" disabled>Select option</option>
                  <option value="never">Never</option>
                  <option value="rarely">Rarely</option>
                  <option value="sometimes">Sometimes</option>
                  <option value="often">Often</option>
                  <option value="regularly">Regularly</option>
                </select>
              </div>
            </div>
          )}

          {step > 0 && (
            <>
              <div className="mb-6 bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl text-blue-200 text-sm">
                Please indicate how much you agree or disagree with each statement based on the match you just played.<br />
                {step === 1 ? '(1 = Strongly Disagree, 7 = Strongly Agree)' : '(0 = Not at all, 4 = Extremely)'}
              </div>

              <div className="space-y-4">
                {currentQuestions.map((q, idx) => (
                  <div key={q.id} className="bg-white/5 p-5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                    <p className="text-white mb-4 font-medium text-lg">
                      <span className="text-blue-400 mr-2">{idx + 1}.</span> 
                      {q.text}
                    </p>
                    <div className="flex justify-between items-center max-w-2xl mx-auto gap-2">
                      <span className="text-xs text-gray-500 w-16 mx-1 sm:w-24 text-right leading-tight">
                        {step === 1 ? 'Strongly Disagree' : 'Not at all'}
                      </span>
                      <div className="flex gap-1 sm:gap-2">
                      {(step === 1 ? [1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4]).map((val) => (
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
                      <span className="text-xs text-gray-500 w-16 mx-1 sm:w-24 leading-tight">
                        {step === 1 ? 'Strongly Agree' : 'Extremely'}
                      </span>
                     </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-800 flex-shrink-0 flex justify-between items-center bg-gray-900 rounded-b-2xl">
          <div className="text-gray-400 text-sm">
            {step === 0 
              ? 'Introduction' 
              : `${Object.keys(answers).filter(k => k.startsWith('pens') || k.startsWith('geq')).length} / ${PENS_QUESTIONS.length + GEQ_QUESTIONS.length} Questions Answered`}
          </div>
          <button 
            onClick={handleNextOrSubmit}
            className={`px-8 py-2.5 rounded-xl font-bold transition-all shadow-lg ${
              allCurrentAnswered 
                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:scale-105' 
                : 'bg-white/10 text-gray-600 cursor-not-allowed border border-white/5'
            }`}
          >
            {step === 0 ? 'Start Survey →' : (step === 1 ? 'Next Part →' : 'Submit Feedback')}
          </button>
        </div>

      </div>
    </div>
  );
}
