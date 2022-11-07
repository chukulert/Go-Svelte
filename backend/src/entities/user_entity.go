package entities

import "github.com/golang-jwt/jwt"

type Users struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	Email     string `json:"email"`
	Status    bool   `json:"status"`
	BelongsTo string `json:"belongsTo"`
	Editor    string `json:"editor"`
}

// GIN
type CheckGroup struct {
	Username string `json:"username"`
	Group    string `json:"group"`
}
type Claims struct {
	Username string `json:"username"`
	jwt.StandardClaims
}
type Auth struct {
	Token string `json:"token"`
	Group string `json:"group"`
}
type Profile struct {
	Token    string `json:"token"`
	Email    string `json:"email"`
	Password string `json:"password"`
}
