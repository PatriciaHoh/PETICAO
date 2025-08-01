import React, { useState, useEffect } from 'react';

// Importações do Firebase
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, onSnapshot, orderBy } from 'firebase/firestore';

const App = () => {
  // Variáveis globais de configuração do Firebase, fornecidas pelo ambiente
  const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

  // Estados do componente
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('login');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [peticao, setPeticao] = useState({
    tipoPeticao: '',
    juizo: '',
    autor: { nome: '', cpf: '', endereco: '', profissao: '' },
    reu: { nome: '', endereco: '' },
    advogado: { nome: '', oab: '' },
    descricaoFatos: '',
    documentos: []
  });
  const [peticaoGerada, setPeticaoGerada] = useState(null);
  const [peticaoStatus, setPeticaoStatus] = useState('');
  const [peticoesHistorico, setPeticoesHistorico] = useState([]);
  const [activeTab, setActiveTab] = useState('gerar'); // 'gerar' ou 'historico'

  // Efeito para inicializar o Firebase e o estado de autenticação
  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const firestore = getFirestore(app);
    const firebaseAuth = getAuth(app);
    setDb(firestore);
    setAuth(firebaseAuth);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (!currentUser && initialAuthToken) {
        try {
          await signInWithCustomToken(firebaseAuth, initialAuthToken);
        } catch (e) {
          console.error("Falha ao entrar com token customizado:", e);
        }
      }
    });

    return () => unsubscribe();
  }, [firebaseConfig, initialAuthToken]);
  
  // Efeito para buscar o histórico de petições
  useEffect(() => {
    if (db && user) {
      const q = query(
        collection(db, 'artifacts', appId, 'users', user.uid, 'peticoes')
      );
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const peticoes = [];
        querySnapshot.forEach((doc) => {
          peticoes.push({ id: doc.id, ...doc.data() });
        });
        setPeticoesHistorico(peticoes);
      }, (error) => {
        console.error("Erro ao buscar histórico de petições:", error);
      });
      
      return () => unsubscribe();
    }
  }, [db, user, appId]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (!auth) throw new Error("Serviço de autenticação não inicializado.");
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      setError('Falha no login. Verifique seu email e senha.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (!auth) throw new Error("Serviço de autenticação não inicializado.");
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      if (db) {
        const userRef = doc(db, 'artifacts', appId, 'users', userCredential.user.uid, 'profile', 'data');
        await setDoc(userRef, {
          email: userCredential.user.email,
          createdAt: new Date(),
          plan: 'Plano Básico'
        });
      }
    } catch (err) {
      console.error(err);
      setError('Falha no cadastro. A senha deve ter pelo menos 6 caracteres.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files).map(file => file.name);
    setPeticao({ ...peticao, documentos: files });
  };

  const generatePetitionWithGemini = async (peticaoData) => {
    const prompt = `
      Você é um assistente especializado em direito previdenciário brasileiro.
      Sua tarefa é gerar uma petição inicial a partir dos dados fornecidos.
      A petição deve ser redigida em linguagem jurídica formal, mas não prolixa.
      Use fundamentos jurídicos pertinentes à área previdenciária.
      É proibido fazer suposições ou criar dados que não existam na descrição dos fatos.
      Estrutura da petição:
      - Endereçamento (Ao Juízo...)
      - Qualificação das partes (Autor e Réu)
      - Breve Síntese dos Fatos
      - Fundamentos Jurídicos (cite a legislação e jurisprudência aplicável)
      - Pedidos
      - Valor da Causa
      - Fechamento e Assinatura

      Dados fornecidos para a petição:
      Tipo de Petição: ${peticaoData.tipoPeticao}
      Juízo: ${peticaoData.juizo}
      Dados do Autor:
        - Nome: ${peticaoData.autor.nome}
        - CPF: ${peticaoData.autor.cpf}
        - Endereço: ${peticaoData.autor.endereco}
        - Profissão: ${peticaoData.autor.profissao}
      Dados do Réu:
        - Nome: ${peticaoData.reu.nome}
        - Endereço: ${peticaoData.reu.endereco}
      Dados do Advogado:
        - Nome: ${peticaoData.advogado.nome}
        - OAB: ${peticaoData.advogado.oab}
      Descrição dos Fatos: ${peticaoData.descricaoFatos}
      Documentos Anexados (nomes dos arquivos): ${peticaoData.documentos.join(', ')}

      Gere a petição completa em formato de texto.
    `;
    
    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    const payload = { contents: chatHistory };
    const apiKey = "AIzaSyDE67fZ_ugaqLrY3KyN55FgYmBlHYiELtg";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    let response;
    for (let i = 0; i < 5; i++) {
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok) break;
            if (response.status === 429) {
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch (error) {
            if (i === 4) throw error;
        }
    }
    
    const result = await response.json();
    if (result.candidates && result.candidates.length > 0) {
      return result.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Não foi possível gerar a petição. Tente novamente.");
    }
  };

  const handlePeticaoSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setPeticaoStatus('A gerar a petição, por favor, aguarde...');
    setPeticaoGerada(null);

    try {
      const generatedText = await generatePetitionWithGemini(peticao);
      
      if (db && user) {
        const peticaoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'peticoes', Date.now().toString());
        await setDoc(peticaoRef, {
          ...peticao,
          peticaoGerada: generatedText,
          userId: user.uid,
          status: 'gerada',
          createdAt: new Date()
        });
      }
      
      setPeticaoGerada(generatedText);
      setPeticaoStatus('Petição gerada com sucesso!');

    } catch (err) {
      console.error('Erro ao submeter petição:', err);
      setPeticaoStatus(`Ocorreu um erro: ${err.message}. Por favor, tente novamente.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = () => {
    if (peticaoGerada) {
      const element = document.createElement("a");
      const file = new Blob([peticaoGerada], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = "peticao_previdenciaria.txt";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    }
  };
  
  const handleRequestReview = () => {
    setPeticaoStatus('A sua petição foi submetida para revisão. Receberá a resposta em até 24 horas.');
  };

  const handleSignOut = async () => {
    try {
      if (!auth) throw new Error("Serviço de autenticação não inicializado.");
      await signOut(auth);
    } catch (err) {
      console.error('Erro ao sair:', err);
      setError('Erro ao sair. Por favor, tente novamente.');
    }
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <p className="text-xl font-medium text-gray-700 animate-pulse">A carregar...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-full max-w-md p-8 m-4 space-y-8 bg-white rounded-xl shadow-2xl">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">
              {view === 'login' ? 'Entrar na sua conta' : 'Criar uma nova conta'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {view === 'login' ? 'Ou ' : 'Já tem uma conta? '}
              <button
                onClick={() => setView(view === 'login' ? 'signup' : 'login')}
                className="font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none"
              >
                {view === 'login' ? 'cadastre-se aqui' : 'Entre aqui'}
              </button>
            </p>
          </div>
          <form onSubmit={view === 'login' ? handleLogin : handleSignup} className="mt-8 space-y-6">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Endereço de e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="relative flex justify-center w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md group hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400"
            >
              {isLoading ? 'A processar...' : (view === 'login' ? 'Entrar' : 'Cadastrar')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen p-8 antialiased text-gray-800 bg-gray-100 font-inter">
      <header className="flex items-center justify-between p-4 mb-8 bg-white rounded-2xl shadow-md">
        <h1 className="text-2xl font-bold text-gray-900">Gerador de Petições</h1>
        <div className="flex items-center space-x-4">
          <span className="text-gray-700 hidden sm:block">Bem-vindo, {user.email}</span>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="flex-grow p-6 bg-white rounded-2xl shadow-md">
        <div className="flex mb-8 border-b border-gray-200">
          <button
            onClick={() => { setActiveTab('gerar'); setPeticaoGerada(null); }}
            className={`px-4 py-2 text-lg font-medium ${activeTab === 'gerar' ? 'border-b-2 border-indigo-500 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Gerar Petição
          </button>
          <button
            onClick={() => setActiveTab('historico')}
            className={`px-4 py-2 text-lg font-medium ${activeTab === 'historico' ? 'border-b-2 border-indigo-500 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Histórico de Petições
          </button>
        </div>

        {activeTab === 'gerar' && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-gray-900">Área de Criação de Petição</h2>
            <p className="mt-2 text-gray-600">
              Preencha os campos abaixo para gerar a petição.
              Utilizaremos seu ID (`{user.uid}`) para guardar as suas petições.
            </p>
            {!peticaoGerada ? (
              <form onSubmit={handlePeticaoSubmit} className="p-6 mt-4 space-y-6 bg-gray-50 rounded-xl">
                {/* Seção 1: Tipo de Petição e Juízo */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <label htmlFor="tipoPeticao" className="block text-sm font-medium text-gray-700">Tipo de Petição</label>
                    <select
                      id="tipoPeticao"
                      name="tipoPeticao"
                      className="block w-full px-3 py-2 mt-1 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      value={peticao.tipoPeticao}
                      onChange={(e) => setPeticao({ ...peticao, tipoPeticao: e.target.value })}
                      required
                    >
                      <option value="">Selecione o tipo de petição</option>
                      <option value="Concessão de Aposentadoria por Idade">Concessão de Aposentadoria por Idade</option>
                      <option value="Aposentadoria por Invalidez">Aposentadoria por Invalidez</option>
                      <option value="Benefício Assistencial (LOAS)">Benefício Assistencial (LOAS)</option>
                      <option value="Salário Maternidade">Salário Maternidade</option>
                      <option value="Auxílio Doença">Auxílio Doença</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="juizo" className="block text-sm font-medium text-gray-700">Juízo ao qual é endereçado</label>
                    <input
                      id="juizo"
                      name="juizo"
                      type="text"
                      className="block w-full px-3 py-2 mt-1 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Ex: Juízo de Direito da Comarca de ..."
                      value={peticao.juizo}
                      onChange={(e) => setPeticao({ ...peticao, juizo: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Seção 2: Dados do Autor */}
                <div className="p-4 rounded-md bg-white border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Dados do Autor</h3>
                  <div className="grid grid-cols-1 gap-4 mt-4 sm:grid-cols-2">
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Nome do Autor"
                      value={peticao.autor.nome}
                      onChange={(e) => setPeticao({ ...peticao, autor: { ...peticao.autor, nome: e.target.value } })}
                      required
                    />
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="CPF"
                      value={peticao.autor.cpf}
                      onChange={(e) => setPeticao({ ...peticao, autor: { ...peticao.autor, cpf: e.target.value } })}
                      required
                    />
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Endereço"
                      value={peticao.autor.endereco}
                      onChange={(e) => setPeticao({ ...peticao, autor: { ...peticao.autor, endereco: e.target.value } })}
                      required
                    />
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Profissão"
                      value={peticao.autor.profissao}
                      onChange={(e) => setPeticao({ ...peticao, autor: { ...peticao.autor, profissao: e.target.value } })}
                      required
                    />
                  </div>
                </div>

                {/* Seção 3: Dados do Réu */}
                <div className="p-4 rounded-md bg-white border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Dados do Réu</h3>
                  <div className="grid grid-cols-1 gap-4 mt-4 sm:grid-cols-2">
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Nome do Réu"
                      value={peticao.reu.nome}
                      onChange={(e) => setPeticao({ ...peticao, reu: { ...peticao.reu, nome: e.target.value } })}
                      required
                    />
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Endereço do Réu"
                      value={peticao.reu.endereco}
                      onChange={(e) => setPeticao({ ...peticao, reu: { ...peticao.reu, endereco: e.target.value } })}
                      required
                    />
                  </div>
                </div>

                {/* Seção 4: Dados do Advogado */}
                <div className="p-4 rounded-md bg-white border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Dados do Advogado</h3>
                  <div className="grid grid-cols-1 gap-4 mt-4 sm:grid-cols-2">
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Nome do Advogado"
                      value={peticao.advogado.nome}
                      onChange={(e) => setPeticao({ ...peticao, advogado: { ...peticao.advogado, nome: e.target.value } })}
                      required
                    />
                    <input
                      type="text"
                      className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md"
                      placeholder="Número da OAB"
                      value={peticao.advogado.oab}
                      onChange={(e) => setPeticao({ ...peticao, advogado: { ...peticao.advogado, oab: e.target.value } })}
                      required
                    />
                  </div>
                </div>

                {/* Seção 5: Descrição dos Fatos */}
                <div>
                  <label htmlFor="descricaoFatos" className="block text-sm font-medium text-gray-700">Descrição dos Fatos</label>
                  <textarea
                    id="descricaoFatos"
                    name="descricaoFatos"
                    rows="6"
                    className="block w-full px-3 py-2 mt-1 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Descreva o caso de forma detalhada, sem fazer suposições. Ex: 'O autor, nascido em XX/XX/XXXX, trabalhou por 15 anos na empresa Y e requereu o benefício no dia...'"
                    value={peticao.descricaoFatos}
                    onChange={(e) => setPeticao({ ...peticao, descricaoFatos: e.target.value })}
                    required
                  />
                </div>
                
                {/* Seção 6: Anexar Documentos */}
                <div className="p-4 rounded-md bg-white border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Anexar Documentos</h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Os nomes dos arquivos serão enviados para ajudar a IA na contextualização.
                  </p>
                  <input
                    type="file"
                    id="documentos"
                    name="documentos"
                    multiple
                    onChange={handleFileChange}
                    className="block w-full mt-2 text-gray-900 placeholder-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  {peticao.documentos.length > 0 && (
                    <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
                      {peticao.documentos.map((doc, index) => (
                        <li key={index}>{doc}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Botão de submissão */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="relative flex justify-center w-full px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md group hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-green-400"
                >
                  {isSubmitting ? 'A gerar petição...' : 'Gerar Petição'}
                </button>
              </form>
            ) : (
              <div className="p-6 mt-4 space-y-6 bg-gray-50 rounded-xl">
                <h3 className="text-lg font-bold text-gray-900">Petição Gerada</h3>
                <div className="p-4 bg-white border border-gray-200 rounded-md whitespace-pre-wrap font-mono text-sm">
                  {peticaoGerada}
                </div>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <button
                    onClick={handleDownload}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    Baixar Petição (.txt)
                  </button>
                  <button
                    onClick={handleRequestReview}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                  >
                    Submeter para Revisão
                  </button>
                </div>
                {peticaoStatus && (
                  <p className="mt-4 text-center text-sm font-medium text-gray-600">
                    {peticaoStatus}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'historico' && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-gray-900">Histórico de Petições</h2>
            <p className="mt-2 text-gray-600">
              Aqui está a lista de todas as petições que gerou.
            </p>
            <div className="mt-4 space-y-4">
              {peticoesHistorico.length > 0 ? (
                peticoesHistorico.map((pet, index) => (
                  <div key={index} className="p-4 bg-white rounded-md shadow-sm">
                    <p className="text-lg font-semibold text-gray-800">{pet.tipoPeticao}</p>
                    <p className="text-sm text-gray-500">Criado em: {new Date(pet.createdAt.toDate()).toLocaleString()}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500">Nenhuma petição gerada ainda.</p>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="p-4 mt-8 text-center text-gray-500">
        <p>&copy; 2024 Gerador de Petições. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
};

export default App;
