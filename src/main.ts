const container = document.getElementById('button-container') || document.body;
const button = document.createElement('button');
button.innerText = 'Click Me';
button.addEventListener('click', () => {
  alert('You clicked the button!');
});

container.appendChild(button);