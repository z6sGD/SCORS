$$\mathcal{T} = \bigparallel_{r=D-1}^{0} \Phi_r\!\left( \left[ f^{(200)}\!\left( \left\lfloor \frac{T_1^{(T_2 \bmod 17)+1} + T_2^{(T_1 \bmod 17)+1} + M_{\text{full}}^{m_4+m_5+1}}{\left(\prod_{k=0}^{7}(u_k+1)(v_k+1)\prod_{j=0}^{5}(m_j+1)\right)^{E}} \right\rfloor \right) \bmod 10^{200} \right] + 10^{199}\mathbb{I}_{p < 10^{190}} \right)$$

This single equation captures the entire `generateScorsDeviceId` pipeline: it blows up the network inputs into a massive nested polynomial, crushes it back down with a BigInt product-power divisor, stretches it through 200 XOR-shift rounds, and maps every resulting base-10 digit into a dynamic QWERTY and Unicode character cipher.

---

### 1. Network Input Variables

* **$u_0 \dots u_7$ & $v_0 \dots v_7$**: The eight 16-bit integer segments of the client's **Public IP** ($u$) and **Local IP** ($v$) normalized to IPv6 format (IPv4 addresses map to `::ffff:w.x.y.z`; invalid inputs default to `2001:0db8::1`).
* **$I_{\text{pub}}$**: The full 128-bit integer value of the public IP, calculated as $\sum_{k=0}^{7} u_k \cdot 2^{16(7-k)}$.
* **$m_0 \dots m_5$ & $M_{\text{full}}$**: The six byte octets of the client's **MAC address** ($m_j \in [0, 255]$) and its combined 48-bit integer value $M_{\text{full}}$ (defaults to `[1, 1, 1, 1, 1, 1]` and `0x010101010101` if omitted).
* **$C_v$**: The **Chrome major version** extracted from the `User-Agent` string (defaults to `100`).

---

### 2. Polynomial Explosion & Divisor Reduction

* **$i_0 \dots i_7$**: The cross-multiplied hardware-network vector, where each segment combines public IP, local IP, and a MAC octet:

$$i_k = u_k \cdot v_k \cdot (m_{k \bmod 6} + 1)$$


* **$T_1$ & $T_2$**: The two asymmetric exponentiation branches (`term1` and `term2`) that amplify small input differences into massive numbers:

$$T_1 = i_0^{(i_7 \bmod 100)+1} + i_1^{(u_0 \bmod 50)+1} \cdot i_2^{(v_0 \bmod 50)+1}$$


$$T_2 = i_3^{(i_4 \bmod 100)+1} + i_5^{(u_7 \bmod 50)+1} \cdot i_6^{(v_7 \bmod 50)+1}$$


* **$E$**: The **User-Agent & minimum-segment exponent** that scales the denominator:

$$E = (\min_{u_k > 1} u_k \bmod 30) + (\min_{v_k > 1} v_k \bmod 30) + (\min_{m_j > 1} m_j \bmod 30) + \left(\sum_{c \in \text{UA}} \text{ASCII}(c) \bmod 13\right) + 1$$


* **$\lfloor \frac{\text{Numerator}}{\text{Denominator}} \rfloor$**: Integer division that compresses the massive polynomial tree back into a manageable seed integer $p_0$ (falling back to `12345678901234567890` if the quotient rounds to `0`).

---

### 3. Work-Factor Stretching & Length Normalization

* **$f^{(200)}(\cdot)$**: The **200-step iterative avalanche loop** applied from $s = 1$ to $200$, mixing bits via XOR ($\oplus$) and 2-bit right shifts ($\lfloor x / 4 \rfloor$):

$$f_s(x) = \big((x \oplus \lfloor x / 4 \rfloor) + s\big) \bmod 10^{200}$$


* **$10^{199}\mathbb{I}_{p < 10^{190}}$**: The **length-padding indicator**—if the 200-step result drops below $10^{190}$, it adds $10^{199}$ so the final token consistently stays 200 characters long.

---

### 4. Dual-Alphabet Token Cipher ($\bigparallel_{r=D-1}^{0} \Phi_r$)

* **$\bigparallel_{r=D-1}^{0}$**: Left-to-right string concatenation across all $D$ base-10 digits of the stretched integer $P$, where $r$ is the digit's position from the right ($r = 0$ is the ones place) and $d_r = \lfloor P / 10^r \rfloor \bmod 10$.
* **$\sigma$**: The **QWERTY home-row rotation offset** (`shiftVal`), derived from the sum of all IP segments and MAC octets modulo $9$:

$$\sigma = \left(\sum_{k=0}^{7}(u_k + v_k) + \sum_{j=0}^{5} m_j\right) \bmod 9$$


* **$\Phi_r(P)$**: The **character-encoding function** that translates each decimal digit $d_r$ into the final string:

$$\Phi_r(P) = \begin{cases} \mathcal{Z}\!\left[(I_{\text{pub}}^{C_v} + z_r) \bmod 49\right], & \text{if } d_r = 0 \\ \text{Case}_{r \bmod 2}\!\Big(\mathcal{Q}\!\left[(d_r - 1 + \sigma) \bmod 9\right]\Big), & \text{if } d_r \neq 0 \end{cases}$$


* **Non-zero digits ($d_r \in \{1\dots 9\}$)** map to the shifted QWERTY home row $\mathcal{Q} = [\text{a, s, d, f, g, h, j, k, l}]$, rendered **UPPERCASE** when $r$ is odd ($r \bmod 2 = 1$) and **lowercase** when $r$ is even ($r \bmod 2 = 0$).
* **Zero digits ($d_r = 0$)** are replaced using modular exponentiation ($I_{\text{pub}}^{C_v} \bmod 49$) offset by the zero's chunk-traversal index $z_r$, selecting from the 49-character symbol table $\mathcal{Z}$ (Punctuation, Cyrillic, CJK, and Greek glyphs).
