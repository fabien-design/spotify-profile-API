const clientId = import.meta.env.VITE_CLIENT_ID;
const redirectUri = import.meta.env.VITE_REDIRECT_URI;
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

async function main() {
    if (!code) {
        redirectToAuthCodeFlow(clientId);
    } else {
        const token = await getToken(clientId, code);
        const profile = await fetchProfile(token);
        populateUI(profile);
        const artists = await getArtists(token);
        generateArtistList(artists);

        initSpotifyIframe();
    }
}

// call the main function to avoid top-level await error 
main().catch((error) => {
    console.error("Error in the main function:", error);
});


export async function redirectToAuthCodeFlow(clientId) {
    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem("verifier", verifier);

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("response_type", "code");
    params.append("redirect_uri", redirectUri);
    params.append(
        "scope",
        "user-read-private user-read-email user-follow-read"
    );
    params.append("code_challenge_method", "S256");
    params.append("code_challenge", challenge);

    document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function generateCodeVerifier(length) {
    let text = "";
    let possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export async function getToken(clientId, code) {
    const accessToken = localStorage.getItem("access_token");
    const expiresAt = localStorage.getItem("expires_at");
    const refreshToken = localStorage.getItem("refresh_token");

    if (
        accessToken && 
        accessToken !== 'undefined' &&
        expiresAt &&
        Date.now() < parseInt(expiresAt)
    ) {
        return accessToken;
    }
    if (refreshToken && accessToken && accessToken !== 'undefined') {
        console.log("Refreshing access token");
        return await refreshAccessToken(clientId, refreshToken);
    }

    return await fetchAccessToken(clientId, code);
}

export async function fetchAccessToken(clientId, code) {
    const verifier = localStorage.getItem("verifier");

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirectUri);
    params.append("code_verifier", verifier);

    const result = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
    });
    const { access_token, refresh_token, expires_in } = await result.json();

    if (!access_token) {
        throw new Error("Failed to fetch access token");
    }

    localStorage.setItem("access_token", access_token);
    if (refresh_token) {
        localStorage.setItem("refresh_token", refresh_token);
    }
    localStorage.setItem("expires_at", Date.now() + expires_in * 1000);

    return access_token;
}

async function fetchProfile(token) {
    const result = await fetch("https://api.spotify.com/v1/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });

    return await result.json();
}

function populateUI(profile) {
    document.getElementById("displayName").innerText = profile.display_name;
    if (profile.images[0]) {
        const profileImage = new Image(200, 200);
        profileImage.src = profile.images[0].url;
        document.getElementById("avatar").appendChild(profileImage);
    }
    document.getElementById("id").innerText = profile.id;
    document.getElementById("email").innerText = profile.email;
    document.getElementById("url").innerText = profile.href;
    document.getElementById("url").setAttribute("href", profile.href);
}


// TODO : Fix the refresh token function (refresh token is revoked)
export async function refreshAccessToken() {
    // refresh token that has been previously stored
    const refreshToken = localStorage.getItem("refresh_token");
    const url = "https://accounts.spotify.com/api/token";

    const payload = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: clientId,
        }),
    };
    const body = await fetch(url, payload);
    const response = await body.json();
    localStorage.setItem("access_token", response.accessToken);
    if (response.refreshToken) {
        localStorage.setItem("refresh_token", response.refreshToken);
    }

    return response.accessToken;
}

export async function getArtists(token) {
    const result = await fetch(
        "https://api.spotify.com/v1/me/following?type=artist",
        {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        }
    );
    const response = await result.json();
    const artists = response.artists.items;
    return artists;
}

function generateArtistList(artists) {
    const section = document.getElementById("artists");
    artists.forEach((artist) => {
        const div = document.createElement("div");
        div.className = "artist";
        div.innerHTML = `<img src="${artist.images[0].url}" alt="${artist.name}" />
                         <h3>${artist.name}</h3>
                         <a href="${artist.external_urls.spotify}" target="_blank">Open in Spotify</a>`;
        section.appendChild(div);
    });
}

// commented because it calls too many times the API
// let searchTimeout;
// document.getElementById("search-form").addEventListener("input", function (e) {
//     e.preventDefault();

//     clearTimeout(searchTimeout);

//     const query = document.getElementById("search-input").value.trim();

//     if (query && query.length >= 2) {
//         searchTimeout = setTimeout(() => {
//             searchTracks(query);
//         }, 500);
//     } else {
//         document.querySelector(".searched-result").innerHTML = "";
//     }
// });

document.querySelector("#search-button").addEventListener("click", function (e) {
    e.preventDefault();

    const query = document.getElementById("search-input").value.trim();

    if (query && query.length >= 2) {
        searchTracks(query);
    } else {
        document.querySelector(".searched-result").innerHTML = "";
    }
});

async function searchTracks(query) {
    const token = await getToken();

    const result = await fetch(
        `https://api.spotify.com/v1/search?q=${query}&type=track&limit=10`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        }
    );

    const response = await result.json();
    const tracks = response.tracks.items;
    displaySearchedTracks(tracks);
}

async function displaySearchedTracks(tracks) {
    const section = document.querySelector(".searched-result");
    section.innerHTML = "";

    tracks.forEach((track) => {
        const div = document.createElement("div");

        div.className = "track";
        div.innerHTML = `
            <div class="infos">
             <img src="${track.album.images[0]?.url}" alt="${track.album.name}" />
             <h3>${track.album.name}</h3>
             <a href="${track.album.external_urls.spotify}" target="_blank">Open in Spotify</a>
            </div>
            <button data-spotify-id="${track.uri}" class="play-btn">Play</button>
        `;
        section.appendChild(div);
    });

}

function initSpotifyIframe() {
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
        const element = document.getElementById('embed-iframe');
        const options = {
            uri: 'spotify:episode:2HOo5H4Wn2SNjOxvvXB9a0'
        };
        const callback = (EmbedController) => {
            const playBtnsHandled = new WeakSet();

            const attachEventHandlers = () => {
                const playBtns = document.querySelectorAll('.track .play-btn');

                playBtns.forEach((btn) => {
                    if (!playBtnsHandled.has(btn)) {
                        btn.addEventListener('click', async (event) => {
                            EmbedController.loadUri(event.currentTarget.dataset.spotifyId);
                        });
                        playBtnsHandled.add(btn);
                    }
                });
            };
            const observer = new MutationObserver(attachEventHandlers);
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Gestion initiale
            attachEventHandlers();
        };
        IFrameAPI.createController(element, options, callback);
    };
}
