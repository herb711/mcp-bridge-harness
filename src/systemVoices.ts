export interface VoiceInfo {
  voice_id: string;
  name: string;
  language: string;
  type: "system";
}

// A compact built-in list. MiniMax publishes a much larger system-voice table;
// this server keeps the list small so the model is not flooded with choices.
export const SYSTEM_VOICES: VoiceInfo[] = [
  { voice_id: "male-qn-qingse", name: "青涩青年音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "male-qn-jingying", name: "精英青年音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "male-qn-badao", name: "霸道青年音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "male-qn-daxuesheng", name: "青年大学生音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "female-shaonv", name: "少女音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "female-yujie", name: "御姐音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "female-chengshu", name: "成熟女性音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "female-tianmei", name: "甜美女性音色", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "clever_boy", name: "聪明男童", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "cute_boy", name: "可爱男童", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "lovely_girl", name: "萌萌女童", language: "Chinese (Mandarin)", type: "system" },
  { voice_id: "Cantonese_ProfessionalHost（F)", name: "专业女主持", language: "Chinese (Cantonese)", type: "system" },
  { voice_id: "Cantonese_GentleLady", name: "温柔女声", language: "Chinese (Cantonese)", type: "system" },
  { voice_id: "Cantonese_ProfessionalHost（M)", name: "专业男主持", language: "Chinese (Cantonese)", type: "system" },
  { voice_id: "Cantonese_PlayfulMan", name: "活泼男声", language: "Chinese (Cantonese)", type: "system" },
  { voice_id: "Santa_Claus", name: "Santa Claus", language: "English", type: "system" },
  { voice_id: "Charming_Lady", name: "Charming Lady", language: "English", type: "system" },
  { voice_id: "Sweet_Girl", name: "Sweet Girl", language: "English", type: "system" },
  { voice_id: "English_Trustworthy_Man", name: "Trustworthy Man", language: "English", type: "system" },
  { voice_id: "English_Graceful_Lady", name: "Graceful Lady", language: "English", type: "system" },
  { voice_id: "Japanese_IntellectualSenior", name: "Intellectual Senior", language: "Japanese", type: "system" },
  { voice_id: "Japanese_DecisivePrincess", name: "Decisive Princess", language: "Japanese", type: "system" },
  { voice_id: "Japanese_GentleButler", name: "Gentle Butler", language: "Japanese", type: "system" },
  { voice_id: "Japanese_KindLady", name: "Kind Lady", language: "Japanese", type: "system" },
  { voice_id: "Korean_SweetGirl", name: "Sweet Girl", language: "Korean", type: "system" },
  { voice_id: "Korean_CheerfulBoyfriend", name: "Cheerful Boyfriend", language: "Korean", type: "system" },
  { voice_id: "Korean_ReliableSister", name: "Reliable Sister", language: "Korean", type: "system" },
  { voice_id: "Spanish_SereneWoman", name: "Serene Woman", language: "Spanish", type: "system" },
  { voice_id: "Spanish_Narrator", name: "Narrator", language: "Spanish", type: "system" }
];
