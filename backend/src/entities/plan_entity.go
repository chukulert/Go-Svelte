package entities

type Plan struct {
	PlanName  string `json:"planname"`
	StartDate string `json:"startdate"`
	EndDate   string `json:"enddate"`
	Acronym   string `json:"acronym"`
	Editor    string `json:"editor"`
	Group     string `json:"group"` //permit needed
}